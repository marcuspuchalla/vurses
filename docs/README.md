# vuecli documentation

Start with **Getting started**; the other pages go deeper.

## Using vuecli

| Page | What's in it |
| --- | --- |
| [Getting started](GETTING-STARTED.md) | requirements, install, your first app, a routed project, examples, the full CLI reference, environment variables, troubleshooting, uninstall |
| [Building apps](GUIDE.md) | how rendering works, layout and styling, every component, composables, keyboard / focus / mouse, themes, the App Router, canvas and images, plain JavaScript, tooling and testing |
| [Existing web apps](WEB.md) | `vuecli web`: running an existing Vite + Vue 3 app in the terminal, keys, options, page colours |
| [Browser, server and deployment](SERVER.md) | the browser devtools-console target, server-streamed routes, `dev` / `build` / `start`, deploy adapters |
| [Error codes](errors.md) | every `VC###` error with its cause and fix |

## Compatibility and security

| Page | What's in it |
| --- | --- |
| [Compatibility](COMPATIBILITY.md) | Node, operating systems and terminals; which web apps, CSS features, libraries and browser APIs work with `vuecli web`, and the known gaps |
| [Security](SECURITY.md) | the trust model of every feature, what's protected by default, deploying the server safely, which files vuecli writes |
| [Security policy](../SECURITY.md) | how to report a vulnerability |

## Contributing

| Page | What's in it |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | how to report problems, set up, test and open a pull request |
| [Architecture](ARCHITECTURE.md) | repository layout, how the parts fit together, extension points |

Packages in this repository have their own READMEs: [tty-canvas](../packages/tty-canvas/README.md)
(the canvas engine), [eslint-plugin-vuecli](../packages/eslint-plugin-vuecli/README.md),
the [VS Code extension](../packages/vscode-vuecli/README.md) and the
[DevTools extension](../packages/devtools-extension/README.md).
