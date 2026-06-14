import { createClient } from "./common.mjs";

const client = createClient();
try {
  await client.init();

  // Find current policy version by scanning memory
  const exportResult = await client.callTool("export", { limit: 100 });
  const bundle = JSON.parse(exportResult.content[0].text);
  const events = bundle.entries
    .map((e) => {
      try { return { entry: e, event: JSON.parse(e.content) }; } catch { return null; }
    })
    .filter(Boolean)
    .filter((e) => e.event.type === "policy_created" || e.event.type === "policy_updated")
    .sort((a, b) => new Date(a.entry.createdAt) - new Date(b.entry.createdAt));

  const prevVersion = events.length > 0 ? events[events.length - 1].event.policyVersion : 0;
  const newVersion = prevVersion + 1;

  // Authorized policy update — new event, never edit the old one
  await client.callTool("remember", {
    content: JSON.stringify({
      type: "policy_updated",
      agent: "daily-ai-news-bot",
      actor: "owner",
      policyVersion: newVersion,
      previousPolicyVersion: prevVersion,
      allowedActions: ["send_ai_news_summary", "send_ai_security_summary"],
      risk: "low",
      status: "active",
    }),
    tags: ["demo", "policy"],
  });

  console.log("AUTHORIZED POLICY UPDATE");
  console.log(`Actor: owner`);
  console.log(`Previous policy: v${prevVersion}`);
  console.log(`New policy: v${newVersion}`);
  console.log("Added action: send_ai_security_summary");
  console.log("Memory: append-only event recorded");
} finally {
  client.close();
}
