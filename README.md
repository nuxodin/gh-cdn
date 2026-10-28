# gh-cdn

A modern, fast, and feature-rich GitHub CDN built with [Hono](https://hono.dev/), running on [Deno](https://deno.land/) or [Bun](https://bun.sh/).

It allows you to serve files directly from GitHub with automatic on-the-fly minification, smart caching, and a clean web interface.

## 🚀 Features

- **GitHub Multi-Repo Support**: Host content from any public GitHub repository.
- **Smart Minification**: Automatic minification for `.js`, `.css`, `.svg` and `.html` files via global `/min/` route.
- **High Performance Caching**:
    - **Browser Cache**: `ETag`, `Last-Modified`, and `Cache-Control` (immutable for tags).
    - **Local Cache**: Fetched files are stored locally in the `cache/` directory.
    - **Smart Sync**: Local files are automatically refreshed from GitHub after expiration (`maxAge`).
- **Web UI**: Navigate through users and repositories via `?html` (e.g., `http://localhost:8080/full/nuxodin?html`).
- **Modern Tech Stack**: Uses [Terser](https://terser.org/), [Lightning CSS](https://lightningcss.dev/), [SVGO](https://github.com/svg/svgo) and [html-minifier-terser](https://github.com/terser/html-minifier-terser).

## 🛠 Installation

Requires [Deno](https://deno.com/) or [Bun](https://bun.sh/).

```bash
git clone <your-repo-url>
cd gh-cdn
```

## 🏃 Usage

### Start the server
```bash
deno task start          # Deno
bun install && bun start # Bun
```
By default, the server listens on `127.0.0.1:8080` — meant to run behind a reverse proxy. Set `PORT` and `HOST` (e.g. `HOST=0.0.0.0` in a container) to change that.

### Development mode
```bash
deno task dev       # Deno
bun --watch server.js # Bun
```

### URL Structure

- **Original source**: `/:user/:repo@:tag/:file`  
  Example: `http://localhost:8080/full/nuxodin/gh-cdn@main/src/app.js`
- **Minified source**: `/:user/:repo@:tag/:file`  
  Example: `http://localhost:8080/min/nuxodin/gh-cdn@main/src/app.js`

*Note: Use `@main` or any tag/branch name. If omitted, it defaults to the main branch.*

## 📂 Project Structure

- `server.js`: The main entry point.
- `src/app.js`: Core CDN logic and routing.
- `src/cache.js`: Local cache, sync with GitHub and HTTP caching headers.
- `src/github.js`: GitHub API access for the web interface.
- `src/compress.js`: Minification engines for JS, CSS, and HTML.
- `src/views.js`: HTML templates for the web interface.
- `cache/`: Local storage for fetched and minified contents.
- `deno.json` / `package.json`: Tasks and dependencies for Deno / Bun.

## ⚙️ Configuration

You can provide your GitHub credentials to avoid rate limiting for the API (web interface):

```bash
GITHUB_USER=your_user GITHUB_TOKEN=your_token bun start
```

## 📜 License

MIT
