/**
 * Secrets provider — resolves Secrets Manager / SSM ARNs to values.
 * Secrets are never hardcoded or logged (conventions.md). Faked in tests.
 */
export interface SecretsProvider {
  /** Resolve a secret by its ARN/id to its string value. */
  getSecret(arn: string): Promise<string>;
}
