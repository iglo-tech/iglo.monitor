# Operating iglo.monitor

The canonical repository is [iglo-tech/iglo.monitor](https://github.com/iglo-tech/iglo.monitor). Download binaries from its [Releases](https://github.com/iglo-tech/iglo.monitor/releases). See the [README](../README.md) for installation and the supported Uptime Kuma SQLite migration path.

## Reverse proxy

iglo.monitor listens on port `3001` by default. Forward requests to the configured host and port, and enable WebSocket forwarding so the dashboard can receive live updates.

When running a proxy on the same host, bind iglo.monitor to loopback:

```bash
./iglo.monitor --host=127.0.0.1 --port=3001 --data-dir=/path/to/data
```

Configure HTTPS at the proxy. Preserve the original `Host` header for status pages with custom domains. In **Settings → Reverse Proxy**, enable **Trust Proxy** when your trusted proxy supplies `X-Forwarded-*` headers. Restrict direct access to the backend port when trusting those headers.

## Cloudflare Tunnel

Install `cloudflared` on the host running iglo.monitor. Configure a tunnel that forwards to the application's local HTTP address, for example `http://127.0.0.1:3001`.

**Settings → Reverse Proxy** shows whether `cloudflared` is available and lets you start or stop a tunnel using its token. Preserve the token as a credential. Enable **Trust Proxy** if the tunnel supplies the forwarded headers needed by your deployment.

## Maintenance

Open **Maintenance** from the profile menu to create a maintenance window. Choose the affected monitors, schedule, duration, and timezone. Maintenance windows can be paused, edited, or deleted from the same screen.

A monitor under maintenance reports maintenance status instead of its usual up/down status. Public status pages can display maintenance information for their included monitors.

## API keys and Prometheus

Enable API keys in settings, then create a key in **Settings → API Keys**. Copy it when created and store it securely; the full value is not shown again. Keys can be disabled or deleted, and can have an expiry date.

Prometheus metrics are exposed at `/metrics`. With API key authentication enabled, use HTTP Basic authentication with an empty username and the API key as the password. For a local check that prompts for the key:

```bash
curl --user '' http://127.0.0.1:3001/metrics
```

Configure your Prometheus scrape target with the same credentials and the application's reachable host and port.

## Badges

Use a monitor's badge link generator to choose a badge type and customize its label, colors, and other supported parameters. Copy the generated URL for the monitor you want to display.

Badge URLs use `/api/badge/<monitor-id>/<badge-type>`. Use the generated URL so its query parameters match the selected type. Treat a published badge as public monitoring information.

## Password recovery

If you can sign in, change your password in **Settings → Security**.

If you are locked out, use the recovery script from an iglo.monitor source checkout with Bun and its locked dependencies installed. These administrative scripts run from source; they are separate from the compiled server executable.

1. Stop the running instance and back up its data directory.
2. From the source checkout, run the interactive reset against that instance's data directory:

    ```bash
    bun run reset-password --data-dir=/path/to/data
    ```

3. Restart iglo.monitor and sign in with the new password. Resetting the password also resets the session signing secret.

If two-factor authentication is preventing access, the separate recovery command is:

```bash
bun run remove-2fa --data-dir=/path/to/data
```

The SQLite filename remains `kuma.db` to preserve the tested database upgrade path.
