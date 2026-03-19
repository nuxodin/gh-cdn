const htmlHead = `<!DOCTYPE html>
<html lang=en>
    <head>
        <meta charset=utf-8>
        <meta name=viewport content=width=device-width>
        <title>CDN</title>
        <script type=module async src="https://cdn.jsdelivr.net/gh/u2ui/u2@main/u2/auto.js"></script>
        <link rel=stylesheet href="https://cdn.jsdelivr.net/gh/u2ui/u2@main/css/classless/simple.css">
        <style>
            html { --color:#a1f; font-size:14px; }
            body { display:block; --width:90rem; }
            table { white-space:nowrap }
        </style>
<body>
`;

const html = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (vals[i] ?? ''), '');
const row = (...cells) => `<tr u2-href>` + cells.map(c => `<td>${c}`).join('');
const escape = (str) => String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[m]);

export function renderUser(user, repos) {
    return htmlHead + html`
        <h1>Organisation: ${escape(user)}</h1>
        <u2-table sortable>
            <table>
                <thead>
                    <tr><th>Repo<th>Description<th>Stars<th>Last change
                <tbody>${repos.map(r => row(
                    `<a href="./${user}/${r.name}?html" style="white-space:nowrap">${escape(r.name)}</a>`,
                    `<small style="display:block; text-overflow:ellipsis; overflow:hidden; max-width:50rem">${r.description ? escape(r.description) : ''}</small>`,
                    r.stargazers_count,
                    `<u2-time datetime="${r.pushed_at}" type=relative></u2-time>`
                )).join('')}
            </table>
        </u2-table>`;
}

export function renderRepo(user, repo, releases) {
    return htmlHead + html`
        <h1>Repo: ${escape(user)}/${escape(repo)}</h1>
        <u2-table><table>
        <thead>
            <tr><th>Tag<th>Published
        <tbody>
            ${releases.map(r => row(
                `<a href="./${user}/${repo}/${r.tag_name}?html">${escape(r.tag_name)}</a>`,
                `<u1-time datetime="${r.published_at}" type=relative>${r.published_at}</u1-time>`
            )).join('')}
            </table>
        </u2-table>`;
}

export function renderRoot(orgs) {
    return htmlHead + html`
        <h1>Popular Organisations</h1>
        <u2-table>
        <table>
            <tbody>
                ${orgs.map(org => row(`<a href="./${org}?html">${escape(org)}</a>`)).join('')}
            </table>
        </u2-table>`;
}
