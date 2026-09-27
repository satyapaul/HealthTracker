import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { PostOpCareLambda } from '../constructs/postopcare-lambda';
import { NetworkingStack } from './networking-stack';
import { DatabaseStack } from './database-stack';
import { RedisStack } from './redis-stack';
import { StorageStack } from './storage-stack';
import { MessagingStack } from './messaging-stack';
import { DataStack } from './data-stack';

export interface ComputeStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
  networkingStack: NetworkingStack;
  databaseStack: DatabaseStack;
  redisStack: RedisStack;
  storageStack: StorageStack;
  messagingStack: MessagingStack;
  dataStack: DataStack;
}

export class ComputeStack extends cdk.Stack {
  // ── API resources ───────────────────────────────────────────────────────────
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly apiUrl: string;
  public readonly webSocketUrl: string;

  // ── Lambda functions (exposed for DataOpsStack alarms) ──────────────────────
  public readonly authFn: PostOpCareLambda;
  public readonly authorizerFn: PostOpCareLambda;
  public readonly patientFn: PostOpCareLambda;
  public readonly followupFn: PostOpCareLambda;
  public readonly doseFn: PostOpCareLambda;
  public readonly milestoneFn: PostOpCareLambda;
  public readonly milestoneEvaluatorFn: PostOpCareLambda;
  public readonly notificationDispatcherFn: PostOpCareLambda;
  public readonly smsSenderFn: PostOpCareLambda;
  public readonly whatsappSenderFn: PostOpCareLambda;
  public readonly emailSenderFn: PostOpCareLambda;
  public readonly inappSenderFn: PostOpCareLambda;
  public readonly virusScanFn: PostOpCareLambda;
  public readonly exportFn: PostOpCareLambda;
  public readonly adminFn: PostOpCareLambda;
  public readonly websocketFn: PostOpCareLambda;

  // ── Back-compat aliases consumed by DataOpsStack ────────────────────────────
  /** @deprecated Use authFn.function directly */
  public get apiHandlerFunction(): lambda.IFunction {
    return this.authFn.function;
  }
  /** @deprecated Use milestoneEvaluatorFn.function directly */
  public get milestoneEvaluatorFunction(): lambda.IFunction {
    return this.milestoneEvaluatorFn.function;
  }
  /** @deprecated Use notificationDispatcherFn.function directly */
  public get notificationDispatcherFunction(): lambda.IFunction {
    return this.notificationDispatcherFn.function;
  }

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      config,
      networkingStack,
      databaseStack,
      redisStack,
      storageStack,
      messagingStack,
      dataStack,
    } = props;
    const isProd = config.env === 'prod';

    // ── Step 1: Common Lambda environment variables ──────────────────────────
    const commonEnv: Record<string, string> = {
      DB_PROXY_ENDPOINT: databaseStack.proxy.endpoint,
      DB_NAME: 'postopcare',
      DB_SECRET_ARN: databaseStack.cluster.secret!.secretArn,
      REDIS_ENDPOINT: redisStack.endpointAddress,
      REDIS_PORT: redisStack.endpointPort,
      ENVIRONMENT: config.env,
      DOMAIN_NAME: config.domainName,
    };

    // ── Step 2: VPC config ───────────────────────────────────────────────────
    const vpcConfig = {
      vpc: networkingStack.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [networkingStack.lambdaSG],
    };

    // ── Step 3: Lambda constructs ────────────────────────────────────────────

    // auth — handles Google OAuth callback, X OAuth callback, SMS OTP, and JWT
    // validation for protected routes via the Lambda authorizer.
    this.authFn = new PostOpCareLambda(this, 'AuthFn', {
      functionName: 'auth',
      description: 'Custom JWT auth: Google OAuth, X OAuth, SMS OTP, session management',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnv,
        // Placeholders — replace with real Secrets Manager ARNs before deploy.
        GOOGLE_CLIENT_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/google-client-secret-${config.env}`,
        X_CLIENT_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/x-client-secret-${config.env}`,
        JWT_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/jwt-secret-${config.env}`,
        SMS_API_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/sms-api-secret-${config.env}`,
      },
      ...vpcConfig,
    });

    // authorizer — dedicated API Gateway request authorizer. Uses the same
    // source folder as authFn but bundles authorizer.ts (exported `authorizer`),
    // which validates the opaque session token against Redis. It needs the
    // Redis/DB env (commonEnv) but NOT the OAuth/SMS secret ARNs.
    this.authorizerFn = new PostOpCareLambda(this, 'AuthorizerFn', {
      functionName: 'auth',
      entryFile: 'authorizer.ts',
      handler: 'authorizer',
      description: 'API Gateway request authorizer: validates session tokens (WP 1.2)',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: { ...commonEnv },
      ...vpcConfig,
    });

    this.patientFn = new PostOpCareLambda(this, 'PatientFn', {
      functionName: 'patient',
      description: 'Patient profile, notification preferences, and notification read status',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: { ...commonEnv },
      ...vpcConfig,
    });

    this.followupFn = new PostOpCareLambda(this, 'FollowupFn', {
      functionName: 'followup',
      description: 'Follow-up rows, pre-signed upload URLs, and attachment confirmation',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnv,
        LAB_REPORTS_BUCKET: storageStack.labReportsBucket.bucketName,
      },
      ...vpcConfig,
    });

    this.doseFn = new PostOpCareLambda(this, 'DoseFn', {
      functionName: 'dose',
      description: 'Medication dose responses and dose history',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: { ...commonEnv },
      ...vpcConfig,
    });

    this.milestoneFn = new PostOpCareLambda(this, 'MilestoneFn', {
      functionName: 'milestone',
      description: 'Milestone CRUD (list, create, update)',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: { ...commonEnv },
      ...vpcConfig,
    });

    // milestoneEvaluator — triggered by EventBridge Scheduler. Long timeout
    // (5 min) to handle fan-out across all due patients.
    this.milestoneEvaluatorFn = new PostOpCareLambda(this, 'MilestoneEvaluatorFn', {
      functionName: 'milestone-evaluator',
      description: 'Scheduled milestone evaluation: enqueues SMS/WhatsApp notifications',
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      environment: {
        ...commonEnv,
        SMS_QUEUE_URL: messagingStack.smsQueue.queue.queueUrl,
        WHATSAPP_QUEUE_URL: messagingStack.whatsappQueue.queue.queueUrl,
      },
      ...vpcConfig,
    });

    // notificationDispatcher — receives from an upstream source and fans out
    // to the per-channel queues.
    this.notificationDispatcherFn = new PostOpCareLambda(this, 'NotificationDispatcherFn', {
      functionName: 'notification',
      description: 'Notification dispatcher: routes events to per-channel FIFO queues',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ...commonEnv,
        INAPP_QUEUE_URL: messagingStack.inappQueue.queue.queueUrl,
        EMAIL_QUEUE_URL: messagingStack.emailQueue.queue.queueUrl,
        SMS_QUEUE_URL: messagingStack.smsQueue.queue.queueUrl,
        WHATSAPP_QUEUE_URL: messagingStack.whatsappQueue.queue.queueUrl,
      },
      ...vpcConfig,
    });

    // Notification channel senders — no DB/Redis needed; no VPC.
    // Each polls its dedicated FIFO queue and calls the upstream provider.

    this.smsSenderFn = new PostOpCareLambda(this, 'SmsSenderFn', {
      functionName: 'notification',
      description: 'SMS channel sender: dequeues from smsQueue and calls SMS gateway',
      handler: 'sms.handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ENVIRONMENT: config.env,
        SMS_QUEUE_URL: messagingStack.smsQueue.queue.queueUrl,
      },
      // No VPC — communicates with SMS gateway over the public internet.
    });

    this.whatsappSenderFn = new PostOpCareLambda(this, 'WhatsappSenderFn', {
      functionName: 'notification',
      description: 'WhatsApp channel sender: dequeues from whatsappQueue and calls WA API',
      handler: 'whatsapp.handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ENVIRONMENT: config.env,
        WHATSAPP_QUEUE_URL: messagingStack.whatsappQueue.queue.queueUrl,
      },
    });

    this.emailSenderFn = new PostOpCareLambda(this, 'EmailSenderFn', {
      functionName: 'notification',
      description: 'Email channel sender: dequeues from emailQueue and sends via SES',
      handler: 'email.handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ENVIRONMENT: config.env,
        EMAIL_QUEUE_URL: messagingStack.emailQueue.queue.queueUrl,
        FROM_EMAIL: `noreply@${config.domainName}`,
      },
    });

    // inappSenderFn needs the WebSocket callback URL — set after wsStage is created.
    // We construct with a placeholder and update the env after wsStage is defined.
    this.inappSenderFn = new PostOpCareLambda(this, 'InappSenderFn', {
      functionName: 'notification',
      description: 'In-app channel sender: dequeues from inappQueue and pushes via WebSocket',
      handler: 'inapp.handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ENVIRONMENT: config.env,
        INAPP_QUEUE_URL: messagingStack.inappQueue.queue.queueUrl,
        // WEBSOCKET_ENDPOINT is added after WebSocket stage creation below.
        WEBSOCKET_ENDPOINT: 'PLACEHOLDER_UPDATED_BELOW',
      },
    });

    // virusScanFn — no VPC; accesses S3 via the gateway VPC endpoint only when
    // collocated with the bucket region. Running outside VPC keeps it simple and
    // avoids Lambda cold-start NAT GW delays for ClamAV/third-party scan calls.
    this.virusScanFn = new PostOpCareLambda(this, 'VirusScanFn', {
      functionName: 'virus-scan',
      description: 'Scans lab report uploads for malware via SNS/S3 events',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(120),
      environment: {
        ENVIRONMENT: config.env,
        LAB_REPORTS_BUCKET: storageStack.labReportsBucket.bucketName,
      },
      // No VPC — S3 access via gateway endpoint; external AV API over internet.
    });

    this.exportFn = new PostOpCareLambda(this, 'ExportFn', {
      functionName: 'export',
      description: 'Generates patient chart PDF exports and presigned download URLs',
      memorySize: 1536,
      timeout: cdk.Duration.seconds(120),
      environment: {
        ...commonEnv,
        EXPORTS_BUCKET: storageStack.exportsBucket.bucketName,
      },
      ...vpcConfig,
    });

    this.adminFn = new PostOpCareLambda(this, 'AdminFn', {
      functionName: 'admin',
      description: 'Admin panel: patients, invites, user roles, protocols',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: { ...commonEnv },
      ...vpcConfig,
    });

    this.websocketFn = new PostOpCareLambda(this, 'WebsocketFn', {
      functionName: 'websocket',
      description: 'WebSocket connect/disconnect/default route handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnv,
        REDIS_ENDPOINT: redisStack.endpointAddress,
      },
      ...vpcConfig,
    });

    // ── Step 4: IAM permissions ──────────────────────────────────────────────

    // Grant Secrets Manager read to all core functions that need DB access.
    const coreDbFunctions: PostOpCareLambda[] = [
      this.authFn,
      this.authorizerFn,
      this.patientFn,
      this.followupFn,
      this.doseFn,
      this.milestoneFn,
      this.milestoneEvaluatorFn,
      this.notificationDispatcherFn,
      this.exportFn,
      this.adminFn,
      this.websocketFn,
    ];
    // Grant via an identity-based policy on each function's role using the secret
    // and KMS key ARN *strings* (Compute -> Database attribute refs). Using
    // dbSecret.grantRead() here would attach a resource policy to the
    // Database-owned secret referencing each Compute role ARN, creating a
    // Database -> Compute reverse edge and a cross-stack dependency cycle.
    const dbSecretArn = databaseStack.cluster.secret!.secretArn;
    const dbKmsKeyArn = databaseStack.encryptionKey.keyArn;
    for (const fn of coreDbFunctions) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: 'DbMasterSecretRead',
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          resources: [dbSecretArn],
        })
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: 'DbSecretKmsDecrypt',
          effect: iam.Effect.ALLOW,
          actions: ['kms:Decrypt'],
          resources: [dbKmsKeyArn],
        })
      );
    }

    // Also grant auth function access to its own secrets (Google, X, JWT, SMS).
    this.authFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AuthSecretsRead',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/google-client-secret-${config.env}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/x-client-secret-${config.env}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/jwt-secret-${config.env}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postopcare/sms-api-secret-${config.env}*`,
        ],
      })
    );

    // S3 access
    storageStack.labReportsBucket.grantReadWrite(this.followupFn.function);
    storageStack.labReportsBucket.grantReadWrite(this.virusScanFn.function);
    storageStack.exportsBucket.grantReadWrite(this.exportFn.function);

    // SQS SendMessage grants for dispatcher and evaluator
    const allQueues = [
      messagingStack.inappQueue.queue,
      messagingStack.emailQueue.queue,
      messagingStack.smsQueue.queue,
      messagingStack.whatsappQueue.queue,
    ];
    for (const q of allQueues) {
      q.grantSendMessages(this.milestoneEvaluatorFn.function);
      q.grantSendMessages(this.notificationDispatcherFn.function);
    }

    // Also grant KMS usage for queues (needed when encryptionKey requires explicit grants)
    messagingStack.encryptionKey.grantEncryptDecrypt(this.milestoneEvaluatorFn.function);
    messagingStack.encryptionKey.grantEncryptDecrypt(this.notificationDispatcherFn.function);
    messagingStack.encryptionKey.grantDecrypt(this.smsSenderFn.function);
    messagingStack.encryptionKey.grantDecrypt(this.whatsappSenderFn.function);
    messagingStack.encryptionKey.grantDecrypt(this.emailSenderFn.function);
    messagingStack.encryptionKey.grantDecrypt(this.inappSenderFn.function);

    // ── DynamoDB (DataStack) grants ──────────────────────────────────────────
    // Granted HERE (not in DataStack) so the grants attach to Compute roles
    // referencing DataStack table/key ARNs (Compute → Data edge). DataStack is
    // created before Compute, so this is one-way and cycle-free. (Previously
    // these lived in DataOpsStack and caused the DataOps↔Compute cycle.)
    dataStack.auditAuthTable.grantWriteData(this.apiHandlerFunction);
    dataStack.reminderDeliveryTable.grantWriteData(this.notificationDispatcherFunction);
    dataStack.auditAuthTable.grantReadData(this.milestoneEvaluatorFunction);
    dataStack.reminderDeliveryTable.grantReadWriteData(this.milestoneEvaluatorFunction);
    dataStack.dynamoKmsKey.grantEncryptDecrypt(this.apiHandlerFunction);
    dataStack.dynamoKmsKey.grantEncryptDecrypt(this.notificationDispatcherFunction);
    dataStack.dynamoKmsKey.grantEncryptDecrypt(this.milestoneEvaluatorFunction);

    // SQS event sources: each sender polls its dedicated channel queue
    this.smsSenderFn.function.addEventSource(
      new lambdaEventSources.SqsEventSource(messagingStack.smsQueue.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );
    this.whatsappSenderFn.function.addEventSource(
      new lambdaEventSources.SqsEventSource(messagingStack.whatsappQueue.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );
    this.emailSenderFn.function.addEventSource(
      new lambdaEventSources.SqsEventSource(messagingStack.emailQueue.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );
    this.inappSenderFn.function.addEventSource(
      new lambdaEventSources.SqsEventSource(messagingStack.inappQueue.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );

    // SES SendEmail for email sender
    this.emailSenderFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'SesSendEmail',
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail', 'ses:SendTemplatedEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${config.domainName}`],
      })
    );

    // Subscribe virusScanFn to the S3→SNS virus scan topic.
    // SnsEventSource handles both the subscription and the Lambda permission.
    this.virusScanFn.function.addEventSource(
      new lambdaEventSources.SnsEventSource(storageStack.virusScanTopic)
    );

    // ── Step 5: JWT Lambda Authorizer ────────────────────────────────────────
    // The dedicated authorizerFn validates the opaque session token on every
    // protected route by checking it against Redis. It returns a SIMPLE
    // (boolean allow/deny) response with no result caching so that revoked
    // tokens are rejected immediately.
    const jwtAuthorizer = new apigatewayv2Authorizers.HttpLambdaAuthorizer(
      'JwtAuthorizer',
      this.authorizerFn.function,
      {
        responseTypes: [apigatewayv2Authorizers.HttpLambdaResponseType.SIMPLE],
        resultsCacheTtl: cdk.Duration.seconds(0),
        identitySource: ['$request.header.Authorization'],
      }
    );

    // ── Step 6: HTTP API Gateway ─────────────────────────────────────────────
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `postopcare-api-${config.env}`,
      description: 'PostOpCare REST API — custom JWT auth (no Cognito)',
      corsPreflight: {
        allowOrigins: [`https://${config.domainName}`],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Helper to add a route without repeating boilerplate.
    const addRoute = (
      path: string,
      method: apigatewayv2.HttpMethod,
      fn: PostOpCareLambda,
      authorizer?: apigatewayv2Authorizers.HttpLambdaAuthorizer
    ): void => {
      this.httpApi.addRoutes({
        path,
        methods: [method],
        integration: new apigatewayv2Integrations.HttpLambdaIntegration(
          // Unique ID: sanitize path + method into a valid construct ID
          `${path.replace(/[/{}]/g, '_')}_${method}`.replace(/^_/, ''),
          fn.function,
          { payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0 }
        ),
        ...(authorizer ? { authorizer } : {}),
      });
    };

    // ── Auth routes (no authorizer) ──────────────────────────────────────────
    addRoute('/auth/google/callback', apigatewayv2.HttpMethod.POST, this.authFn);
    addRoute('/auth/x/callback', apigatewayv2.HttpMethod.POST, this.authFn);
    addRoute('/auth/otp/send', apigatewayv2.HttpMethod.POST, this.authFn);
    addRoute('/auth/otp/verify', apigatewayv2.HttpMethod.POST, this.authFn);

    // Session management routes require a valid JWT
    addRoute('/auth/session', apigatewayv2.HttpMethod.DELETE, this.authFn, jwtAuthorizer);
    addRoute('/auth/me', apigatewayv2.HttpMethod.GET, this.authFn, jwtAuthorizer);

    // ── Patient routes ───────────────────────────────────────────────────────
    addRoute('/patients/{id}', apigatewayv2.HttpMethod.GET, this.patientFn, jwtAuthorizer);
    addRoute('/patients/{id}', apigatewayv2.HttpMethod.PUT, this.patientFn, jwtAuthorizer);

    // ── Follow-up routes ─────────────────────────────────────────────────────
    addRoute('/followup/rows', apigatewayv2.HttpMethod.GET, this.followupFn, jwtAuthorizer);
    addRoute('/followup/rows', apigatewayv2.HttpMethod.POST, this.followupFn, jwtAuthorizer);
    addRoute('/followup/rows/{id}', apigatewayv2.HttpMethod.GET, this.followupFn, jwtAuthorizer);
    addRoute(
      '/followup/rows/{id}/submit',
      apigatewayv2.HttpMethod.PUT,
      this.followupFn,
      jwtAuthorizer
    );
    addRoute(
      '/followup/rows/{id}/attachments/presign',
      apigatewayv2.HttpMethod.POST,
      this.followupFn,
      jwtAuthorizer
    );
    addRoute(
      '/followup/rows/{id}/attachments/confirm',
      apigatewayv2.HttpMethod.POST,
      this.followupFn,
      jwtAuthorizer
    );

    // ── Dose routes ──────────────────────────────────────────────────────────
    addRoute(
      '/followup/rows/{id}/response',
      apigatewayv2.HttpMethod.PUT,
      this.doseFn,
      jwtAuthorizer
    );
    addRoute(
      '/followup/rows/{id}/dose-history',
      apigatewayv2.HttpMethod.GET,
      this.doseFn,
      jwtAuthorizer
    );

    // ── Milestone routes ─────────────────────────────────────────────────────
    addRoute('/milestones', apigatewayv2.HttpMethod.GET, this.milestoneFn, jwtAuthorizer);
    addRoute('/milestones', apigatewayv2.HttpMethod.POST, this.milestoneFn, jwtAuthorizer);
    addRoute('/milestones/{id}', apigatewayv2.HttpMethod.PUT, this.milestoneFn, jwtAuthorizer);

    // ── Notification routes ──────────────────────────────────────────────────
    addRoute('/notifications', apigatewayv2.HttpMethod.GET, this.patientFn, jwtAuthorizer);
    addRoute(
      '/notifications/{id}/read',
      apigatewayv2.HttpMethod.PUT,
      this.patientFn,
      jwtAuthorizer
    );
    addRoute('/notifications/read-all', apigatewayv2.HttpMethod.PUT, this.patientFn, jwtAuthorizer);
    addRoute(
      '/notifications/preferences',
      apigatewayv2.HttpMethod.GET,
      this.patientFn,
      jwtAuthorizer
    );
    addRoute(
      '/notifications/preferences',
      apigatewayv2.HttpMethod.PUT,
      this.patientFn,
      jwtAuthorizer
    );

    // ── Export routes ────────────────────────────────────────────────────────
    addRoute(
      '/export/chart/{patientId}',
      apigatewayv2.HttpMethod.POST,
      this.exportFn,
      jwtAuthorizer
    );
    addRoute(
      '/export/{exportId}/download',
      apigatewayv2.HttpMethod.GET,
      this.exportFn,
      jwtAuthorizer
    );

    // ── Admin routes ─────────────────────────────────────────────────────────
    addRoute('/admin/patients', apigatewayv2.HttpMethod.POST, this.adminFn, jwtAuthorizer);
    addRoute('/admin/patients', apigatewayv2.HttpMethod.GET, this.adminFn, jwtAuthorizer);
    addRoute('/admin/invites', apigatewayv2.HttpMethod.POST, this.adminFn, jwtAuthorizer);
    addRoute('/admin/users', apigatewayv2.HttpMethod.GET, this.adminFn, jwtAuthorizer);
    addRoute('/admin/users/{id}/role', apigatewayv2.HttpMethod.PUT, this.adminFn, jwtAuthorizer);
    addRoute('/admin/protocols', apigatewayv2.HttpMethod.GET, this.adminFn, jwtAuthorizer);
    addRoute('/admin/protocols', apigatewayv2.HttpMethod.POST, this.adminFn, jwtAuthorizer);

    // ── Step 7: WebSocket API ────────────────────────────────────────────────
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `postopcare-ws-${config.env}`,
      description: 'PostOpCare real-time WebSocket API for in-app notifications',
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'WsConnect',
          this.websocketFn.function
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'WsDisconnect',
          this.websocketFn.function
        ),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'WsDefault',
          this.websocketFn.function
        ),
      },
    });

    const wsStage = new apigatewayv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: this.webSocketApi,
      stageName: config.env,
      autoDeploy: true,
    });

    // Grant websocketFn permission to push messages to connected clients
    // via the @connections Management API.
    this.websocketFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'WsManageConnections',
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/${config.env}/POST/@connections/*`,
        ],
      })
    );

    // inappSenderFn also needs ManageConnections to push to browsers.
    this.inappSenderFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InappWsManageConnections',
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/${config.env}/POST/@connections/*`,
        ],
      })
    );

    // Patch inappSenderFn's WEBSOCKET_ENDPOINT env var now that wsStage.callbackUrl
    // is available. CDK handles this as a CloudFormation-level reference.
    (this.inappSenderFn.function.node.defaultChild as lambda.CfnFunction).addPropertyOverride(
      'Environment.Variables.WEBSOCKET_ENDPOINT',
      wsStage.callbackUrl
    );

    // ── Step 8: EventBridge Scheduler for MilestoneEvaluator ────────────────
    // Two schedules:
    //   1. daily-milestone-check  — 08:00 IST (02:30 UTC) for 48h review window
    //   2. hourly-same-day-check  — every hour for same-day due items

    // EventBridge Scheduler role — owned HERE (not in MessagingStack) so its
    // policy can reference the MilestoneEvaluator Lambda ARN without mutating a
    // Messaging-owned resource (that reverse Messaging -> Compute edge created a
    // cross-stack dependency cycle). The CfnSchedules below live in this stack too.
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: `postopcare-scheduler-role-${config.env}`,
      description: 'EventBridge Scheduler role to invoke MilestoneEvaluator Lambda',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeMilestoneEvaluator',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          this.milestoneEvaluatorFn.function.functionArn,
          // Include version/alias ARNs in case the Lambda is versioned later.
          `${this.milestoneEvaluatorFn.function.functionArn}:*`,
        ],
      })
    );

    // Scheduler group — groups both schedules together for easier management.
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'MilestoneScheduleGroup', {
      name: `postopcare-milestone-${config.env}`,
    });

    // Schedule 1: daily at 02:30 UTC (08:00 IST). 15-min flexible window
    // spreads invocations to avoid thundering-herd on DB.
    new scheduler.CfnSchedule(this, 'DailyMilestoneSchedule', {
      name: `postopcare-daily-milestone-check-${config.env}`,
      description: 'Daily 48-hour milestone review window (08:00 IST / 02:30 UTC)',
      groupName: scheduleGroup.name,
      scheduleExpression: 'cron(30 2 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: {
        mode: 'FLEXIBLE',
        maximumWindowInMinutes: 15,
      },
      state: 'ENABLED',
      target: {
        arn: this.milestoneEvaluatorFn.function.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ scope: '48h' }),
        retryPolicy: {
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 3600,
        },
      },
    });

    // Schedule 2: every hour for same-day due items. 5-min flexible window.
    new scheduler.CfnSchedule(this, 'HourlySameDaySchedule', {
      name: `postopcare-hourly-same-day-check-${config.env}`,
      description: 'Hourly same-day milestone check',
      groupName: scheduleGroup.name,
      scheduleExpression: 'cron(0 * * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: {
        mode: 'FLEXIBLE',
        maximumWindowInMinutes: 5,
      },
      state: 'ENABLED',
      target: {
        arn: this.milestoneEvaluatorFn.function.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ scope: 'same-day' }),
        retryPolicy: {
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 900,
        },
      },
    });

    // ── Store top-level URL strings ──────────────────────────────────────────
    this.apiUrl = this.httpApi.apiEndpoint;
    this.webSocketUrl = wsStage.url;

    // ── Step 9: CloudFormation Outputs ───────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: `PostOpCare-ApiUrl-${config.env}`,
      description: 'HTTP API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: wsStage.url,
      exportName: `PostOpCare-WebSocketUrl-${config.env}`,
      description: 'WebSocket API stage URL',
    });

    // Lambda ARNs — consumed by DataOpsStack for alarms and log metric filters
    const lambdaOutputs: Array<[string, PostOpCareLambda]> = [
      ['AuthFnArn', this.authFn],
      ['PatientFnArn', this.patientFn],
      ['FollowupFnArn', this.followupFn],
      ['DoseFnArn', this.doseFn],
      ['MilestoneFnArn', this.milestoneFn],
      ['MilestoneEvaluatorFnArn', this.milestoneEvaluatorFn],
      ['NotificationDispatcherFnArn', this.notificationDispatcherFn],
      ['SmsSenderFnArn', this.smsSenderFn],
      ['WhatsappSenderFnArn', this.whatsappSenderFn],
      ['EmailSenderFnArn', this.emailSenderFn],
      ['InappSenderFnArn', this.inappSenderFn],
      ['VirusScanFnArn', this.virusScanFn],
      ['ExportFnArn', this.exportFn],
      ['AdminFnArn', this.adminFn],
      ['WebsocketFnArn', this.websocketFn],
    ];

    for (const [outputId, fn] of lambdaOutputs) {
      new cdk.CfnOutput(this, outputId, {
        value: fn.function.functionArn,
        exportName: `PostOpCare-${outputId}-${config.env}`,
      });
    }
  }
}
