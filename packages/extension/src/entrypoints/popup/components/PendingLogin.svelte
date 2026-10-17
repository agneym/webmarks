<script lang="ts">
  import type { Message } from "../../../messages";
  import type { LoginState } from "../../../storage";

  let { login }: { login: Extract<LoginState, { status: "pending" }> } = $props();

  const send = (msg: Message) => chrome.runtime.sendMessage(msg);
</script>

<h1>Approve sign-in</h1>
<p>Approve the request in the tab that just opened. The code should match:</p>
<p class="code">{login.userCode}</p>
<div class="row">
  <button type="button" onclick={() => chrome.tabs.create({ url: login.verificationUri })}>
    Open approval page
  </button>
  <button type="button" class="secondary" onclick={() => send({ type: "cancel-login" })}>
    Cancel
  </button>
</div>
