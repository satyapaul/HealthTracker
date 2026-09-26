// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  IMPORTANT — REGION REQUIREMENT                                          ║
// ║                                                                          ║
// ║  This stack (EdgeStack) MUST be deployed to us-east-1.                  ║
// ║                                                                          ║
// ║  Reasons:                                                                ║
// ║    1. CloudFront is a global service that uses us-east-1 as its         ║
// ║       control plane. CloudFront distributions must be created in        ║
// ║       us-east-1 for CDK cross-region references to work correctly.      ║
// ║                                                                          ║
// ║    2. WAF WebACLs with scope=CLOUDFRONT must ALSO be created in         ║
// ║       us-east-1. This is an AWS hard requirement — WAF rejects          ║
// ║       CLOUDFRONT-scoped WebACLs created in any other region.            ║
// ║                                                                          ║
// ║    3. ACM certificates for custom CloudFront domains must be            ║
// ║       provisioned in us-east-1.                                         ║
// ║                                                                          ║
// ║  In bin/app.ts the EdgeStack is instantiated with:                      ║
// ║    env: { account: config.account, region: 'us-east-1' }               ║
// ║                                                                          ║
// ║  See: https://docs.aws.amazon.com/AmazonCloudFront/latest/             ║
// ║       DeveloperGuide/distribution-web-awswaf.html                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { StorageStack } from './storage-stack';
import { ComputeStack } from './compute-stack';

// ─────────────────────────────────────────────────────────────────────────────
// EdgeStack
// Provisions the CloudFront CDN, WAF WebACL, and CloudFront access log bucket
// for the PostOp Care platform.
//
// Must be deployed to us-east-1 (see header comment above).
// bin/app.ts passes { env: { account, region: 'us-east-1' } } for this stack.
// ─────────────────────────────────────────────────────────────────────────────

export interface EdgeStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
  storageStack: StorageStack;
  computeStack: ComputeStack;
}

export class EdgeStack extends cdk.Stack {
  /** CloudFront distribution serving static assets + API */
  public readonly distribution: cloudfront.Distribution;
  /** WAF WebACL attached to the CloudFront distribution */
  public readonly wafWebAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const { config, storageStack, computeStack } = props;
    const env = config.env;
    const isProd = env === 'prod';

    // ── 1. WAF WebACL (scope=CLOUDFRONT — MUST be us-east-1) ─────────────────
    //
    // Managed rule groups added:
    //   Priority  1 — AWSManagedRulesCommonRuleSet    (OWASP Top 10 baseline)
    //   Priority  2 — AWSManagedRulesKnownBadInputsRuleSet
    //   Priority  3 — AWSManagedRulesSQLiRuleSet
    //   Priority 10 — Rate limit: /auth/*    → 2000 req / 5 min / IP → Block
    //   Priority 11 — Rate limit: /auth/otp/* → 500 req / 5 min / IP → Block
    this.wafWebAcl = new wafv2.CfnWebACL(this, 'WafWebAcl', {
      name: `postopcare-waf-${env}`,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `postopcare-waf-${env}`,
        sampledRequestsEnabled: true,
      },
      rules: [
        // ── Managed: Common Rule Set (priority 1) ─────────────────────────
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `postopcare-waf-common-${env}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
        // ── Managed: Known Bad Inputs (priority 2) ─────────────────────────
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `postopcare-waf-bad-inputs-${env}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        },
        // ── Managed: SQL Injection (priority 3) ───────────────────────────
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `postopcare-waf-sqli-${env}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
        },
        // ── Rate limit: /auth/* → 2000 req / 5 min / IP (priority 10) ─────
        {
          name: 'RateLimitAuthPaths',
          priority: 10,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `postopcare-waf-rate-auth-${env}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/auth/',
                  textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                },
              },
            },
          },
        },
        // ── Rate limit: /auth/otp/* → 500 req / 5 min / IP (priority 11) ──
        {
          name: 'RateLimitOtpPaths',
          priority: 11,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `postopcare-waf-rate-otp-${env}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: 500,
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/auth/otp/',
                  textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                },
              },
            },
          },
        },
      ],
    });

    // ── 2. CloudFront Origin Access Identity for assets bucket ────────────────
    // NOTE: aws-cdk-lib 2.155.0 does not expose the L2 OAC constructs. We use an
    // Origin Access Identity (OAI). The OAI is created and granted read/decrypt
    // in the STORAGE stack (see storage-stack.ts `assetsOai`) so the bucket/KMS
    // policy mutations stay there — consuming it here keeps the dependency
    // one-way (Edge -> Storage) and avoids the cross-region synth cycle that a
    // `grantRead` originating from EdgeStack produced.
    const oai = storageStack.assetsOai;

    // ── 3. S3 Origin for assetsBucket using the shared OAI ────────────────────
    // The read grant is already applied in the Storage stack; passing the OAI
    // here only wires it into the distribution origin config. The bucket stays private.
    const s3Origin = new cloudfrontOrigins.S3Origin(storageStack.assetsBucket, {
      originAccessIdentity: oai,
    });

    // ── 4. HTTP API origin ────────────────────────────────────────────────────
    // computeStack.apiUrl is the full HTTPS URL, e.g.:
    //   https://<id>.execute-api.ap-south-1.amazonaws.com
    // CloudFront HttpOrigin requires just the domain name (no scheme).
    // We strip the 'https://' prefix using Fn.select + Fn.split.
    const apiDomain = cdk.Fn.select(1, cdk.Fn.split('https://', computeStack.apiUrl));

    const apiOrigin = new cloudfrontOrigins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: '',
    });

    // ── 5. Dedicated S3 bucket for CloudFront access logs ─────────────────────
    // CloudFront access logs bucket must have ACLs enabled (legacy requirement).
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `postopcare-cf-access-logs-${cdk.Aws.ACCOUNT_ID}-${env}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      // CloudFront writes logs using the log-delivery service; ACL grants are
      // handled by objectOwnership + CloudFront service principal bucket policy.
      lifecycleRules: [
        {
          id: 'cf-logs-ttl',
          enabled: true,
          expiration: cdk.Duration.days(isProd ? 90 : 30),
        },
      ],
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ── 6. CloudFront Distribution ────────────────────────────────────────────
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `PostOp Care CDN (${env})`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: this.wafWebAcl.attrArn,

      // Uncomment and set AcmCertificateArn after provisioning ACM cert in us-east-1
      // certificate: acm.Certificate.fromCertificateArn(this, 'AcmCert',
      //   'arn:aws:acm:us-east-1:<ACCOUNT>:certificate/<CERT_ID>'
      // ),
      // domainNames: [`app.${config.domainName}`],

      defaultBehavior: {
        // Serve static SPA assets from S3 via OAC
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },

      additionalBehaviors: {
        // All /api/* requests are forwarded to the HTTP API Gateway
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          compress: false,
        },
      },

      // SPA routing: 404 and 403 from S3 → serve index.html with HTTP 200
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],

      enableLogging: true,
      logBucket: accessLogsBucket,
      logFilePrefix: `cloudfront/${env}/`,
    });

    // ── 7. Assets bucket read + KMS decrypt access ────────────────────────────
    // Both grants (bucket read + KMS decrypt for the OAI) are applied in the
    // Storage stack where the bucket and key live, so no policy on a
    // Storage-owned resource references an Edge-owned construct. Nothing to do here.

    // ── 8. CloudFormation Outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: `PostOpCare-DistributionId-${env}`,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      exportName: `PostOpCare-DistributionDomainName-${env}`,
    });

    new cdk.CfnOutput(this, 'WafWebAclArn', {
      value: this.wafWebAcl.attrArn,
      exportName: `PostOpCare-WafWebAclArn-${env}`,
    });
  }
}
