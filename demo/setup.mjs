import { createClient } from "./common.mjs";

const client = createClient();
try {
  await client.init();

  // Agent identity
  await client.callTool("remember", {
    content: JSON.stringify({
      type: "agent_created",
      agent: "daily-ai-news-bot",
      createdBy: "owner",
      status: "active",
    }),
    tags: ["demo", "identity"],
  });

  // Policy v1
  await client.callTool("remember", {
    content: JSON.stringify({
      type: "policy_created",
      agent: "daily-ai-news-bot",
      actor: "owner",
      policyVersion: 1,
      allowedActions: ["send_ai_news_summary"],
      schedule: "daily_08_00",
      risk: "low",
      status: "active",
    }),
    tags: ["demo", "policy"],
  });

  console.log("AGENT CREATED");
  console.log("Agent: Daily AI News Bot");
  console.log("Policy: v1");
  console.log("Allowed action: send_ai_news_summary");
  console.log("Memory: append-only event recorded");
} finally {
  client.close();
}
