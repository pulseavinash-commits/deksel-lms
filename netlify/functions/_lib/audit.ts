import { db } from './db';

export async function audit(adminId: string | null, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await db().from('audit_log').insert({ admin_id: adminId, action, detail });
  } catch (e) {
    console.error('audit failed', e);
  }
}
