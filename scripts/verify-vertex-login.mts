

import { PiBackend } from "../packages/backend/src/index.ts";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR!;
const authPath = join(agentDir, "auth.json");
const modelsPath = join(agentDir, "models.json");
const fakeCreds = join(agentDir, "fake-sa.json");

async function main() {
  await mkdir(agentDir, { recursive: true });
  await writeFile(modelsPath, "{}\n");
  await writeFile(authPath, "{}\n");
  await writeFile(
    fakeCreds,
    JSON.stringify({
      type: "service_account",
      project_id: "fake-project",
      client_email: "probe@fake-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
    }),
  );

  const backend = new PiBackend({ defaultCwd: "/tmp", projectTrust: false, permissionExtension: false });
  await backend.init();


  const providers = await backend.settings.listProviders();
  const vertex = providers.find((p) => p.id === "google-vertex");
  console.log("provider 行能力标记:", vertex && {
    configured: vertex.configured,
    apiKeyLogin: vertex.apiKeyLogin,
    oauth: vertex.oauth,
    models: vertex.models.length,
  });


  const loginId = `smoke-${Date.now()}`;
  const prompts: { promptId: string; prompt: { type: string; message: string } }[] = [];
  const events: string[] = [];
  const unsub = backend.onLoginEvent((payload) => {
    console.log("[event 到达]", payload.kind, payload.kind === "prompt" ? payload.prompt.type : payload.event.type);
    if (payload.loginId !== loginId) return;
    if (payload.kind === "prompt") {

      const { promptId, prompt } = payload;
      prompts.push({ promptId, prompt: prompt as never });
      if (prompt.type === "select") {
        console.log("  [select options]", JSON.stringify((prompt as { options?: { id: string }[] }).options?.map((o) => o.id)));
      }
      const answer =
        prompt.type === "select" ? "adc" : prompt.message.includes("project") ? "fake-project" : "us-central1";
      void backend.login.respond(loginId, promptId, answer);
      return;
    }
    if (payload.kind === "event") {
      events.push(payload.event.type);
      if (payload.event.type === "info") console.log("  [info]", payload.event.message.slice(0, 120));
    }
  });

  console.log("[startLogin] 开始");
  const result = await backend.login.startLogin(loginId, "google-vertex");
  console.log("[startLogin] 结束");
  unsub();
  console.log("login result:", JSON.stringify(result));
  console.log("SDK 事件:", events.join(", "));
  console.log("prompts 收集:", prompts.map((p) => `${p.prompt.type}:${p.prompt.message}`).join(" | "));


  const auth = JSON.parse(await readFile(authPath, "utf8"));
  console.log("auth.json google-vertex =>", JSON.stringify(auth["google-vertex"]));


  await backend.settings.listProviders();
  const after = (await backend.settings.listProviders()).find((p) => p.id === "google-vertex");
  console.log("登录后状态:", after && { configured: after.configured, authSource: after.authSource });
  console.log("(注: 假服务账号无法真正请求——本次只验证配置链路,不验证网络请求)");

  backend.dispose();
}

void main();
