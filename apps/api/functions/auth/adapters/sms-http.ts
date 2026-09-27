/**
 * HTTP SMS gateway adapter (MSG91/Twilio-style) using global fetch (Node 22).
 * Message bodies are non-PHI (built by the OTP service). Secret resolved lazily.
 */
import { AppError } from '../envelope';
import type { SmsGateway } from '../ports/sms';
import type { SecretsProvider } from '../ports/secrets';

interface SmsConfig {
  endpoint: string;
  apiSecretArn: string;
  sender: string;
}

export function makeHttpSmsGateway(cfg: SmsConfig, secrets: SecretsProvider): SmsGateway {
  return {
    async send({ to, message }) {
      const apiKey = await secrets.getSecret(cfg.apiSecretArn);
      let res: Response;
      try {
        res = await fetch(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ to, from: cfg.sender, message }),
        });
      } catch {
        throw new AppError('SERVICE_UNAVAILABLE', 'SMS gateway unreachable');
      }
      if (!res.ok) {
        throw new AppError('SERVICE_UNAVAILABLE', 'SMS gateway error');
      }
    },
  };
}
