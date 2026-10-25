# File Edit Workflow Test — authenticated MCP edit check

This line was added through the MCP edit_file tool to verify that signed-in edit requests reach the approval workflow.

- Expected: the proposal remains pending until accepted.
- Batch test proposal C: change line 6 only.
This harmless file is used to verify targeted MCP edits and the review workflow.

## Test cases
- Replace a specific line without overwriting unrelated content. (Diff request A)
- Insert multiple lines and inspect the proposed diff. (Diff request B)
- Confirm changes remain pending until explicitly accepted. (Diff request C)
- Confirm declining a proposal preserves the original file. (Diff request D)

## Expected behavior
- The command is shown collapsed by default in the activity feed.
- The review summary appears above the signed-in user information.
- Overall additions and deletions are shown as `+N` and `−N`.
- Accept all and Decline all resolve pending proposals safely.

