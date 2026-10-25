import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "../agent/agent";
import { AgentActivity } from "../ui/activity";

async function withAgent(run: (agent: Agent, root: string, activity: AgentActivity) => Promise<void>): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vortiqlabs-review-"));
    const activity = new AgentActivity();
    const agent = new Agent(undefined, root, activity);
    try { await run(agent, root, activity); }
    finally { await agent.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
}

test("file.write is staged until accepted, then applied", async () => withAgent(async (agent, root, activity) => {
    fs.writeFileSync(path.join(root, "example.ts"), "const value = 1;\n");
    const response = await agent.handle({ id: "review-accept", tool: "file.write", arguments: { path: "example.ts", content: "const value = 2;\n" } });
    assert.equal(response.success, true);
    const result = response.result as { pendingApproval: boolean; changeReview: { id: string; status: string; preview: string } };
    assert.equal(result.pendingApproval, true);
    assert.match(result.changeReview.preview, /const value = 2/);
    assert.equal(fs.readFileSync(path.join(root, "example.ts"), "utf8"), "const value = 1;\n", "proposal must not change disk before approval");
    await agent.resolveChangeReview(result.changeReview.id, "accept");
    assert.equal(fs.readFileSync(path.join(root, "example.ts"), "utf8"), "const value = 2;\n");
    const updated = JSON.parse(activity.snapshot()[0].resultText || "{}");
    assert.equal(updated.changeReview.status, "accepted");
}));

test("declining a proposal leaves the original file unchanged", async () => withAgent(async (agent, root) => {
    fs.writeFileSync(path.join(root, "example.ts"), "original\n");
    const response = await agent.handle({ id: "review-decline", tool: "file.write", arguments: { path: "example.ts", content: "proposed\n" } });
    assert.equal(response.success, true);
    const result = response.result as { changeReview: { id: string } };
    await agent.resolveChangeReview(result.changeReview.id, "decline");
    assert.equal(fs.readFileSync(path.join(root, "example.ts"), "utf8"), "original\n");
}));

test("accepting a stale proposal is rejected to protect intervening edits", async () => withAgent(async (agent, root) => {
    const filePath = path.join(root, "example.ts");
    fs.writeFileSync(filePath, "original\n");
    const response = await agent.handle({ id: "review-conflict", tool: "file.write", arguments: { path: "example.ts", content: "proposed\n" } });
    assert.equal(response.success, true);
    const result = response.result as { changeReview: { id: string } };
    fs.writeFileSync(filePath, "newer user edit\n");
    await assert.rejects(() => agent.resolveChangeReview(result.changeReview.id, "accept"), /changed while it was awaiting review/i);
    assert.equal(fs.readFileSync(filePath, "utf8"), "newer user edit\n");
}));


test("queued proposals for the same file can be accepted sequentially without allowing unrelated edits", async () => withAgent(async (agent, root) => {
    const filePath = path.join(root, "example.ts");
    fs.writeFileSync(filePath, "line one\nline two\nline three\n");
    const first = await agent.handle({ id: "review-queued-1", tool: "file.replace_range", arguments: { path: "example.ts", startLine: 1, endLine: 1, content: "first accepted" } });
    const second = await agent.handle({ id: "review-queued-2", tool: "file.replace_range", arguments: { path: "example.ts", startLine: 2, endLine: 2, content: "second accepted" } });
    if (!first.success || !second.success) { throw new Error("Expected both queued proposals to be created successfully."); }
    const firstReview = (first.result as { changeReview: { id: string } }).changeReview;
    const secondReview = (second.result as { changeReview: { id: string } }).changeReview;
    await agent.resolveChangeReview(firstReview.id, "accept");
    await agent.resolveChangeReview(secondReview.id, "accept");
    assert.equal(fs.readFileSync(filePath, "utf8"), "first accepted\nsecond accepted\nline three\n");
}));
