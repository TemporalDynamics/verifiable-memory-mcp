import { createClient } from "./common.mjs";

const client = createClient();
try {
  await client.init();

  await client.callTool("remember", {
    content: JSON.stringify({
      type: "policy_update_requested",
      agent: "daily-ai-news-bot",
      actor: "delegate",
      requestedAction: "create_monthly_transfer",
      amount: 50,
      currency: "USD",
      destination: "account_8856",
      risk: "high",
      status: "pending_owner_approval",
    }),
    tags: ["demo", "request"],
  });

  console.log("SENSITIVE REQUEST RECORDED");
  console.log("Actor: delegate");
  console.log("Requested action: create_monthly_transfer");
  console.log("Amount: 50 USD");
  console.log("Destination: account_8856");
  console.log("Risk: HIGH");
  console.log("Status: pending_owner_approval");
} finally {
  client.close();
}
