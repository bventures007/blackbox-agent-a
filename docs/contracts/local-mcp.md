# Local MCP launcher and authorization boundary

The local client command is the absolute path to the installation's `blackbox` wrapper with argument `mcp`. Start the initialized backend first with `./blackbox up`. The bridge uses the bundled Node image through Docker/Compose; it does not require Node or Rust in the host launcher's PATH. A downloaded versioned installation package is still being completed; this contract also applies to the development wrapper with its prebuilt images.

Create a named read-only key in **Agents & MCP**. Supply `BLACKBOX_AGENT_KEY` through the client's protected environment, or use `BLACKBOX_AGENT_KEY_FILE` pointing to an owned, regular, single-link file with mode 0600 (0400 is also accepted). Do not put key bytes in command arguments, URLs or Git. The wrapper rejects personal owner keys and unsafe files before launching a container. The API remains the authority for current grants, expiry and revocation; the prefix is not proof of authorization.

An illustrative local stdio client configuration is:

```json
{
  "mcpServers": {
    "blackbox": {
      "command": "/absolute/blackbox-installation/blackbox",
      "args": ["mcp"],
      "env": {
        "BLACKBOX_AGENT_KEY_FILE": "/absolute/private-agent.key"
      }
    }
  }
}
```

Use the configuration shape supported by the chosen client. This is not remote OAuth or a public gateway. A cloud-only client cannot reach this Mac's private loopback service. The built-in 24 question templates need no model subscription or key. An external client may forward retrieved business content to its own model provider; Blackbox does not do so automatically.

The dedicated `mcp` Compose service has no database URLs, data/internal/identity keys, host runtime mount, or Docker socket. It runs as the installation UID/GID with a read-only root, all capabilities dropped, no new privileges, a 16-MiB temporary filesystem, a 256-MiB memory limit, 64 process/thread slots and one CPU ceiling. Only the named agent key and fixed API/port parameters are supplied. The maintenance `tooling` service is separate and is never the agent client command.

The bridge connects only to its own project's exact internal `http://api:8080` origin and sends the API's exact loopback Host authority. Development direct-Node mode can use loopback; the synthetic fixture flag is not enabled in the packaged service. Transport refuses redirects and arbitrary origins/paths, bounds requests to 2 MiB and responses to 4 MiB, and enforces a five-second deadline. Every tool call checks the agent's current authorization through the API. Static tool descriptions are not sensitive workspace data. Tools expose authorized reads only; unsupported write/admin operations are rejected.

Host commands pin the protected installation's Compose project explicitly and discard ambient `BB_*`/`COMPOSE_*` overrides before supplying validated values. Unrelated shell profiles cannot select another project, port, credential set or test profile. Ordinary host commands strip agent-key environment variables; only the fixed MCP service receives the selected token. The wrapper replaces itself with Compose for stdio/signal handling and prints no protocol-disrupting stdout.

Actual SDK wrapper verification is provided by `python3 scripts/verify-packaged-mcp.py --output .runtime/packaged-mcp.json --node-image-commit IMAGE_SOURCE_COMMIT --engine-image-commit ENGINE_SOURCE_COMMIT`. It creates a fresh synthetic installation on port 18763, hides Node/Rust from the bridge PATH, uses the maintained SDK client, inspects only its own running bridge's boundaries, checks persisted answers and revocation on an existing connection, and stops the fixture. Execution against the committed implementation must be recorded before claiming a pass. The previous direct-Node SDK/Inspector proof is not substituted for this wrapper proof or the distribution/performance gates.
