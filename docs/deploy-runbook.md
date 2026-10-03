# Sandbox Deploy Runbook — PostOpCare Infrastructure

**Purpose:** Bring up the PostOpCare AWS infrastructure in a **dedicated sandbox/dev account**
for the first time, apply DB migrations, and retire the deferred DoDs (WP 0.3 `cdk deploy`,
WP 0.4 Flyway apply/rollback, WP 1.3 cross-patient integration test).

> **This provisions real, billing, PHI-capable infrastructure** (Aurora Serverless v2, NAT
> Gateways, ElastiCache Redis, CloudFront/WAF across two regions). Use an **isolated sandbox
> account**, deploy incrementally, and tear down when done to control cost.

---

## 0. Prerequisites & identity model

**Use a dedicated IAM identity — NEVER the AWS root account.** Root is for account-level tasks
only and should stay locked behind MFA. All deploys use IAM.

- **Account:** a dedicated **sandbox/dev** AWS account, separate from any production.
- **Regions:** `ap-south-1` (primary — all stacks) and `us-east-1` (Edge/CloudFront/WAF only).
- **Local tooling already required by the repo:** Node 22, npm. Additionally install the
  **AWS CLI v2** (`aws --version`).
- **Credentials never go into the repo or into chat.** They live only in your local `~/.aws/`.

### Recommended IAM user

Create one IAM user dedicated to CDK deploys in the sandbox:

- **User name:** `postopcare-cdk-deployer`
- **Access type:** programmatic (access key) — or prefer IAM Identity Center SSO (see §1b).
- **Permissions (sandbox only):** attach the AWS-managed **`AdministratorAccess`** policy.
  Rationale: CDK provisions across many services (VPC, RDS, ElastiCache, S3, Lambda, API
  Gateway, SQS/SNS, DynamoDB, KMS, IAM roles, CloudFormation). Broad admin is acceptable in an
  **isolated sandbox**; scope it down for staging/prod later.
- **Enable MFA** on the user.

---

## 1a. Option A — IAM user + access key (simplest)

1. In the sandbox account console: **IAM → Users → Create user** → name `postopcare-cdk-deployer`.
2. Attach policy **`AdministratorAccess`**. Create the user. Enable MFA.
3. **IAM → Users → postopcare-cdk-deployer → Security credentials → Create access key**
   (use case: "Command Line Interface"). Copy the Access key ID + Secret.
4. Configure locally into a named profile (keeps it separate from any other AWS creds):
   ```sh
   aws configure --profile postopcare-sandbox
   #   AWS Access Key ID     : <paste>
   #   AWS Secret Access Key : <paste>
   #   Default region name   : ap-south-1
   #   Default output format : json
   ```
5. Verify:
   ```sh
   aws sts get-caller-identity --profile postopcare-sandbox
   ```
   Note the `Account` value — you'll pass it as the CDK account.

> Treat the access key like a password. Delete it from IAM when the sandbox work is done.

## 1b. Option B — IAM Identity Center (SSO) — preferred if available

Short-lived credentials, nothing long-lived on disk.

```sh
aws configure sso --profile postopcare-sandbox
#   SSO start URL, SSO region, then pick the sandbox account + a role with admin
aws sso login --profile postopcare-sandbox
aws sts get-caller-identity --profile postopcare-sandbox
```

For every command below, either add `--profile postopcare-sandbox` or export:

```sh
export AWS_PROFILE=postopcare-sandbox
```

---

## 2. Set deploy environment variables

From the repo root. These feed `infra/bin/app.ts` (`CDK_DEFAULT_ACCOUNT`, region, env, etc.):

```sh
export AWS_PROFILE=postopcare-sandbox
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=ap-south-1
export ENVIRONMENT=dev            # -> stacks are named PostOpCare-<Layer>-dev
export ALERT_EMAIL=you@example.com
# DOMAIN_NAME defaults to postopcare.in; override if you own a different domain.
```

## 3. Install & synth (local sanity check — no AWS calls)

```sh
cd infra
npm ci
npm run synth        # must succeed; produces cdk.out/ (no resources created)
```

---

## 4. Bootstrap CDK (one-time per account+region)

CDK needs a bootstrap stack (`CDKToolkit`: an S3 asset bucket, ECR repo, deploy roles) in
**both** regions this app uses. Run once each:

```sh
cd infra
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/ap-south-1
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/us-east-1   # required for the Edge stack
```

---

## 5. Secrets (required before the Compute stack)

`compute-stack.ts` references these Secrets Manager secrets by ARN (currently placeholders).
Create them in **ap-south-1** before deploying Compute/Edge. Values can be dummy for a sandbox
bring-up (auth against real Google/X/SMS won't work until real values are set, but the stack
will deploy and the DB/Redis paths work):

```sh
for s in google-client-secret x-client-secret jwt-secret sms-api-secret; do
  aws secretsmanager create-secret \
    --name "postopcare/$s-dev" \
    --secret-string "REPLACE_ME_dev_placeholder" \
    --region ap-south-1 --profile postopcare-sandbox
done
```

> For a first bring-up you may skip §5 and deploy only the data/foundation layers in §6 up to
> and including **Data**, deferring **Compute**/**Observability**/**Edge** until real secrets exist.

---

## 6. Deploy stacks in dependency order

The current stacks (env `dev`) and their order. **Note:** the `npm run deploy:*` scripts in
`infra/package.json` are STALE (they still reference the removed `DataOps` stack and predate the
`Data`/`Observability` split) — use the explicit `cdk deploy` commands below instead. See §9.

Preview each with `cdk diff` first, then deploy. Deploy one layer at a time and confirm it
reaches `CREATE_COMPLETE` before the next.

```sh
cd infra

# Layer 1
npx cdk diff   PostOpCare-Networking-dev
npx cdk deploy PostOpCare-Networking-dev

# Layer 2 (independent of each other; all depend on Networking except Storage/Messaging/Data)
npx cdk deploy PostOpCare-Database-dev
npx cdk deploy PostOpCare-Redis-dev
npx cdk deploy PostOpCare-Storage-dev
npx cdk deploy PostOpCare-Messaging-dev
npx cdk deploy PostOpCare-Data-dev

# Layer 3 (needs the §5 secrets)
npx cdk deploy PostOpCare-Compute-dev

# Layer 4 (after Compute)
npx cdk deploy PostOpCare-Observability-dev
npx cdk deploy PostOpCare-Edge-dev          # deploys to us-east-1 automatically
```

Deploys will pause for approval on IAM/security-group changes (that's expected and good —
review them). To skip prompts in a sandbox, append `--require-approval never`.

---

## 7. Apply database migrations (Flyway) — retires WP 0.4 / enables WP 1.3

After the Database stack is up, migrate the Aurora cluster. The DB is in **private subnets**, so
run Flyway from inside the VPC (a bastion/SSM session or a CodeBuild step) — it is NOT reachable
from your laptop directly.

1. Get the RDS Proxy endpoint + master secret:
   ```sh
   aws cloudformation describe-stacks --stack-name PostOpCare-Database-dev \
     --region ap-south-1 --profile postopcare-sandbox \
     --query "Stacks[0].Outputs"
   # note ProxyEndpoint and DBSecretArn
   ```
2. From an in-VPC host with Flyway + the `db/` folder, set the env and migrate:
   ```sh
   export FLYWAY_URL="jdbc:postgresql://<proxy-endpoint>:5432/postopcare"
   export FLYWAY_USER="postopcare_master"
   export FLYWAY_PASSWORD="<from Secrets Manager DBSecretArn>"
   cd db && npm run info && npm run migrate      # applies V1, V2, V3
   ```
3. **Rollback test (WP 0.4 DoD):** on a throwaway/scratch DB only, exercise a down path or
   `flyway clean` + re-migrate to confirm reproducibility. NEVER `clean` a shared DB
   (`cleanDisabled=true` guards this).

---

## 8. Verify, then TEAR DOWN to stop cost

- Smoke-check: hit the API base URL (Compute stack output) `/auth/otp/send` etc.
- Confirm alarms/dashboard exist (Observability stack).
- **Tear down when done** (sandbox — avoids ongoing charges):
  ```sh
  cd infra
  npx cdk destroy PostOpCare-Edge-dev PostOpCare-Observability-dev PostOpCare-Compute-dev \
                  PostOpCare-Data-dev PostOpCare-Messaging-dev PostOpCare-Storage-dev \
                  PostOpCare-Redis-dev PostOpCare-Database-dev PostOpCare-Networking-dev
  ```
  (Destroy in reverse dependency order. Some resources with `RETAIN` removal policy in prod are
  `DESTROY` in dev, so dev tears down cleanly. Delete the §5 secrets and the CDKToolkit stacks
  separately if you want a full cleanup.)

---

## 9. Known fix-up before/after deploy

The `infra/package.json` deploy scripts are out of date and should be corrected (small infra WP):

- `deploy:dataops` targets `PostOpCare-DataOps-*` — that stack no longer exists.
- No `deploy:data` / `deploy:observability` scripts exist for the split stacks.
  Until fixed, use the explicit `cdk deploy PostOpCare-<Stack>-dev` commands in §6.

---

## What I (the agent) can and cannot do here

- I have **no AWS credentials** in this environment and cannot create the IAM user, bootstrap,
  or deploy. Those credentialed steps are yours (or run them where credentials are configured).
- I **can**: prepare/verify the CDK (`synth`/`diff`), fix the stale deploy scripts (§9), write
  the migration/verify commands, and walk through any failures you paste back.
- **Do not paste secret keys into chat.** Configure them locally via `aws configure` / SSO.
