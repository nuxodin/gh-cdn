/**
 * Reads a source file, minifies it based on extension, and writes to outputPath.
 */
export async function tryCompress(inputPath, outputPath) {
    const ext = inputPath.match(/\.(\w+)$/)?.[1];
    const contents = await Deno.readTextFile(inputPath);

    let compressed;
    if (ext === "js") {
        const terser = await import("terser");
        const result = await terser.minify(contents, { module: true, ecma: 2016 });
        compressed = result.code;
        // } else if (ext === "disabled-css") {
        //   const { minify } = await import("csso");
        //   compressed = minify(contents).css;

    } else if (ext === "css") {
        const { transform } = await import("npm:lightningcss");
        const { code } = transform({
            filename: inputPath,
            code: new TextEncoder().encode(contents),
            minify: true,
        });
        compressed = new TextDecoder().decode(code);
    } else if (ext === "svg") {
        const { optimize } = await import("npm:svgo");
        compressed = optimize(contents, {
            path: inputPath,
            multipass: true,
            plugins: [{
                name: "preset-default",
                params: {
                    overrides: {
                        cleanupIds: false,       // externe Referenzen (#id in CSS/JS) bleiben
                        removeViewBox: false,    // Skalierbarkeit bleibt erhalten
                        removeHiddenElems: false, // evtl. per Animation sichtbar
                        convertShapeToPath: false, // <rect>/<circle> bleiben semantisch
                    },
                },
            }],
        }).data;
    } else if (ext === "json") {
        compressed = JSON.stringify(JSON.parse(contents));
    } else if (ext === "html") {
        const { minify } = await import("html-minifier-terser");
        compressed = await minify(contents, {
            collapseWhitespace: true,
            removeComments: true,
            conservativeCollapse: true,
            minifyCSS: false,
            minifyJS: false,
        });
    } else {
        throw new Error(`Unsupported type for compression: .${ext}`);
    }

    const { ensureFile } = await import("std/fs/mod.ts");
    await ensureFile(outputPath);
    await Deno.writeTextFile(outputPath, compressed);
}
