import test from "node:test";
import assert from "node:assert/strict";
import { AgentActivity } from "../ui/activity";

test("Agent Activity records request lifecycle and streams terminal chunks", () => {
    const activity = new AgentActivity();
    const snapshots: Array<Array<{ id: string; status: string; stdout: string; stderr: string }>> = [];
    const subscription = activity.subscribe(items => snapshots.push(items.map(item => ({ id: item.id, status: item.status, stdout: item.stdout, stderr: item.stderr }))));
    activity.start({ id: "test-1", tool: "terminal.execute", arguments: { command: "echo hi" } });
    activity.appendTerminal("test-1", "stdout", "hi");
    activity.appendTerminal("test-1", "stderr", "warning");
    activity.finish({ id: "test-1", success: true, result: { stdout: "hi", stderr: "warning", exitCode: 0 } }, 12);
    const item = activity.snapshot()[0];
    assert.equal(item.status, "success");
    assert.equal(item.durationMs, 12);
    assert.equal(item.stdout, "hi");
    assert.equal(item.stderr, "warning");
    assert.equal(item.exitCode, 0);
    assert.ok(snapshots.length >= 4, "should publish running, chunk, and completed snapshots");
    subscription.dispose();
});

test("Agent Activity retains bounded request history and supports clear", () => {
    const activity = new AgentActivity();
    for (let i = 0; i < 75; i++) {activity.start({ id: `request-${i}`, tool: "workspace.get", arguments: {} });}
    assert.equal(activity.snapshot().length, 50);
    activity.clear();
    assert.equal(activity.snapshot().length, 0);
});


test("clear retains pending code-change reviews so they cannot become orphaned", () => {
    const activity = new AgentActivity();
    activity.start({ id: "pending-review", tool: "file.write", arguments: { path: "sample.ts" } });
    activity.finish({ id: "pending-review", success: true, result: { pendingApproval: true, changeReview: { id: "review-1", status: "pending" } } }, 1);
    activity.start({ id: "completed", tool: "workspace.get", arguments: {} });
    activity.finish({ id: "completed", success: true, result: { name: "workspace" } }, 1);
    activity.clear();
    assert.deepEqual(activity.snapshot().map(item => item.id), ["pending-review"]);
});
