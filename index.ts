// Викликається cron'ом щохвилини. Шле web push для нагадувань, час яких настав.
// Деплой: supabase functions deploy send-reminders --no-verify-jwt
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async () => {
  const { data: due, error } = await supabase
    .from("reminders")
    .select("id, device_id, title, body, fire_at")
    .is("sent_at", null)
    .lte("fire_at", new Date().toISOString())
    .limit(200);

  if (error) return json({ error: error.message }, 500);
  if (!due?.length) return json({ sent: 0 });

  const ids = [...new Set(due.map((r) => r.device_id))];
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("device_id, subscription")
    .in("device_id", ids);

  const byDevice = new Map((subs ?? []).map((s) => [s.device_id, s.subscription]));
  const sentIds: string[] = [];
  const deadDevices: string[] = [];

  for (const r of due) {
    const sub = byDevice.get(r.device_id);
    if (!sub) { sentIds.push(r.id); continue; }   // немає підписки — не тримаємо чергу
    try {
      await webpush.sendNotification(
        sub,
        JSON.stringify({ title: r.title, body: r.body, tag: r.id, url: "./index.html" }),
      );
      sentIds.push(r.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {          // підписка протухла
        deadDevices.push(r.device_id);
        sentIds.push(r.id);
      } else {
        console.error("push failed", r.id, code, String(e));
      }
    }
  }

  if (sentIds.length) {
    await supabase.from("reminders")
      .update({ sent_at: new Date().toISOString() })
      .in("id", sentIds);
  }
  if (deadDevices.length) {
    await supabase.from("push_subscriptions").delete().in("device_id", deadDevices);
  }

  return json({ due: due.length, sent: sentIds.length, dropped: deadDevices.length });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
