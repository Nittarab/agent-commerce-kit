# Host-configured model runtime

`packages/agent/model.ts` exports `createChatModel(options)`, a real HTTP chat-completion adapter for the existing bounded `runAgent` harness. It sends a host-owned task and observations to an explicitly configured model endpoint. There is no default provider, endpoint or model, and constructing it makes no request.

```ts
import { createChatModel } from '../packages/agent/model.ts';
import { runAgent } from '../packages/agent/index.ts';

const model = createChatModel({
  endpoint: process.env.MODEL_ENDPOINT!,
  model: process.env.MODEL_NAME!,
  apiKey: process.env.MODEL_API_KEY!,
  task: 'Obtain the approved report through the permitted merchant.',
  instructions: 'Use inspect before proposing a purchase.',
  toolNames: ['inspect', 'buy'],
});
// The application supplies these guarded tools, including input validation.
// const result = await runAgent(model, { inspect, buy }, {
//   maxSteps: 8, timeoutMs: 120_000,
// });
```

The endpoint must accept a JSON chat-completion POST with `messages`, `response_format: { type: 'json_object' }`, `temperature: 0`, and `max_tokens: 2048`. Responses must contain exactly one choice, `finish_reason: 'stop'`, and a JSON string in `message.content`. Native function calling and streaming are not used. Provider compatibility needs verification against the chosen deployment; fixture success does not establish it.

Model decisions have exactly one of these shapes:

```json
{"type":"tool","name":"inspect","input":{}}
```

```json
{"type":"done","output":"Report received"}
```

Extra fields, malformed JSON, unknown tool names, partial completions and provider-native tool calls fail closed. A tool proposal is not authorization. The host must validate each tool's input, bind its own actor, wallet and account identities, enforce policy, and reserve shared budgets before signing. Never expose a tool that accepts model-selected credentials or rewrites policy. The adapter neither signs nor transfers funds.

The API credential remains in a closure and the HTTP authorization header. It is excluded from generated prompts; literal credential echoes in configuration, observations and parsed decisions are rejected. Errors discard provider response bodies and exception text. This is not general secret scanning: the host must keep all signing keys and actor credentials out of tasks and tool results, and redact sensitive observations before inference. Endpoint selection is a trusted host configuration decision. HTTPS is required except for loopback HTTP; URL credentials, query strings, fragments and HTTP redirects are rejected.

Requests have a 30-second deadline and also honor the harness cancellation signal. Bounds are 8 KiB each for task and instructions, 64 KiB and 100 entries for history, 64 KiB for the response body, 16 KiB for the decision, 8 KiB for tool input, and 32 allowed tool names. The harness additionally controls its overall step count and deadline. Cancellation stops waiting for a provider; it is not an operating-system sandbox and does not undo any previously submitted payment.

`tests/model.test.ts` uses only injected fixture responses and simulated tools. It verifies decision validation, secret-safe errors, streaming limits and cancellation without contacting a model provider, merchant, facilitator or blockchain. Live inference, live swarm settlement, multichain execution, and full Poppy conformance are not established by this adapter's tests.
