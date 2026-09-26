import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkingStack } from '../lib/stacks/networking-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { RedisStack } from '../lib/stacks/redis-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { MessagingStack } from '../lib/stacks/messaging-stack';
import { ComputeStack } from '../lib/stacks/compute-stack';
import { DataOpsStack } from '../lib/stacks/data-ops-stack';
import { EdgeStack } from '../lib/stacks/edge-stack';

interface PostOpCareConfig {
  env: string;
  account: string;
  region: string;
  domainName: string;
  alertEmail: string;
}

const config: PostOpCareConfig = {
  env: process.env.ENVIRONMENT ?? 'dev',
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '',
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
  domainName: process.env.DOMAIN_NAME ?? 'postopcare.in',
  alertEmail: process.env.ALERT_EMAIL ?? 'ops@postopcare.in',
};

const app = new cdk.App();

const stackEnv = {
  account: config.account,
  region: config.region,
};

const commonTags = {
  Project: 'PostOpCare',
  Environment: config.env,
  ManagedBy: 'CDK',
};

// Helper to apply tags to a stack
function tagStack(stack: cdk.Stack): void {
  Object.entries(commonTags).forEach(([key, value]) => {
    cdk.Tags.of(stack).add(key, value);
  });
}

// Layer 1: Networking (no dependencies)
const networkingStack = new NetworkingStack(app, `PostOpCare-Networking-${config.env}`, {
  stackName: `PostOpCare-Networking-${config.env}`,
  env: stackEnv,
  config,
});
tagStack(networkingStack);

// Layer 2a: Database (depends on networking)
const databaseStack = new DatabaseStack(app, `PostOpCare-Database-${config.env}`, {
  stackName: `PostOpCare-Database-${config.env}`,
  env: stackEnv,
  config,
  networkingStack,
});
databaseStack.addDependency(networkingStack);
tagStack(databaseStack);

// Layer 2b: Redis (depends on networking)
const redisStack = new RedisStack(app, `PostOpCare-Redis-${config.env}`, {
  stackName: `PostOpCare-Redis-${config.env}`,
  env: stackEnv,
  config,
  networkingStack,
});
redisStack.addDependency(networkingStack);
tagStack(redisStack);

// Layer 2c: Storage (independent)
// crossRegionReferences: the us-east-1 EdgeStack consumes this stack's assets
// bucket + KMS key; enabling this lets CDK wire those cross-region refs (via SSM)
// instead of failing/creating a synth cycle.
const storageStack = new StorageStack(app, `PostOpCare-Storage-${config.env}`, {
  stackName: `PostOpCare-Storage-${config.env}`,
  env: stackEnv,
  config,
  crossRegionReferences: true,
});
tagStack(storageStack);

// Layer 2d: Messaging (independent)
const messagingStack = new MessagingStack(app, `PostOpCare-Messaging-${config.env}`, {
  stackName: `PostOpCare-Messaging-${config.env}`,
  env: stackEnv,
  config,
});
tagStack(messagingStack);

// Layer 3: Compute (depends on all layer 2 stacks)
const computeStack = new ComputeStack(app, `PostOpCare-Compute-${config.env}`, {
  stackName: `PostOpCare-Compute-${config.env}`,
  env: stackEnv,
  config,
  networkingStack,
  databaseStack,
  redisStack,
  storageStack,
  messagingStack,
  // EdgeStack (us-east-1) consumes apiUrl from this stack.
  crossRegionReferences: true,
});
computeStack.addDependency(networkingStack);
computeStack.addDependency(databaseStack);
computeStack.addDependency(redisStack);
computeStack.addDependency(storageStack);
computeStack.addDependency(messagingStack);
tagStack(computeStack);

// Layer 4a: DataOps (depends on compute + messaging for Lambda ARNs + queue ARNs)
const dataOpsStack = new DataOpsStack(app, `PostOpCare-DataOps-${config.env}`, {
  stackName: `PostOpCare-DataOps-${config.env}`,
  env: stackEnv,
  config,
  computeStack,
  messagingStack,
});
dataOpsStack.addDependency(computeStack);
dataOpsStack.addDependency(messagingStack);
tagStack(dataOpsStack);

// Layer 4b: Edge / CDN
// NOTE: WAF WebACLs for CloudFront MUST be created in us-east-1.
// The EdgeStack should be deployed with region override to us-east-1,
// or WAF should be separated into a dedicated us-east-1 stack.
// For now EdgeStack deploys CloudFront + Route53 in the primary region;
// WAF is managed separately or via a cross-region reference.
const edgeStack = new EdgeStack(app, `PostOpCare-Edge-${config.env}`, {
  stackName: `PostOpCare-Edge-${config.env}`,
  env: { account: config.account, region: 'us-east-1' }, // CloudFront + WAF must be us-east-1
  config,
  storageStack,
  computeStack,
  // Consumes ap-south-1 Storage + Compute resources across regions.
  crossRegionReferences: true,
});
edgeStack.addDependency(storageStack);
edgeStack.addDependency(computeStack);
tagStack(edgeStack);

app.synth();
