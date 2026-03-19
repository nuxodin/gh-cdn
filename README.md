# gh-cdn

A modern, fast, and feature-rich GitHub CDN built with [Deno](https://deno.land/) and [Hono](https://hono.dev/).

It allows you to serve files directly from GitHub with automatic on-the-fly minification, smart caching, and a clean web interface.

## 🚀 Features

- **GitHub Multi-Repo Support**: Host content from any public GitHub repository.
- **Smart Minification**: Automatic minification for `.js`, `.css`, and `.html` files via global `/min/` route.
- **High Performance Caching**:
    - **Browser Cache**: `ETag`, `Last-Modified`, and `Cache-Control` (immutable for tags).
    - **Local Cache**: Fetched files are stored locally in the `cache/` directory.
    - **Smart Sync**: Local files are automatically refreshed from GitHub after expiration (`maxAge`).
- **Web UI**: Navigate through users and repositories via `?html` (e.g., `http://localhost:8080/full/nuxodin?html`).
- **Modern Tech Stack**: Uses [Terser](https://terser.org/), [CSSO](https://github.com/css/csso), and [html-minifier-terser](https://github.com/terser/html-minifier-terser).

## 🛠 Installation

Ensuring you have [Deno](https://deno.com/manual/getting_started/installation) installed.

```bash
git clone <your-repo-url>
cd gh-cdn
```

## 🏃 Usage

### Start the server
```bash
deno task start
```
By default, the server runs on port `8080`.

### Development mode
```bash
deno task dev
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
- `src/compress.js`: Minification engines for JS, CSS, and HTML.
- `src/views.js`: HTML templates for the web interface.
- `cache/`: Local storage for fetched and minified contents.
- `deno.json`: Task definitions and dependencies.

## ⚙️ Configuration

You can provide your GitHub credentials to avoid rate limiting for the API (web interface):

```bash
GITHUB_USER=your_user GITHUB_TOKEN=your_token deno task start
```

## 📜 License

MIT
