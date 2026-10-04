import { Card } from '../ui';

/**
 * Temporary stand-in for screens not yet built out. Each real screen replaces
 * its placeholder in a later work package.
 */
export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: 700 }}>{title}</h1>
      <Card>
        <p style={{ color: 'var(--color-text-muted)' }}>{note ?? 'This screen is coming soon.'}</p>
      </Card>
    </div>
  );
}
