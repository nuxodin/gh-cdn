/**
 * Reads a source file, minifies it based on extension, and writes to outputPath.
 * Supported: .js, .css, .html
 */
export async function tryCompress(inputPath, outputPath) {
  const ext = inputPath.match(/\.(\w+)$/)?.[1];
  const contents = await Deno.readTextFile(inputPath);

  let compressed;
  if (ext === "js") {
    const terser = await import("terser");
    const result = await terser.minify(contents, { module: true, ecma: 2016 });
    compressed = result.code;
  } else if (ext === "disabled-css") {
    const { minify } = await import("csso");
    compressed = minify(contents).css;
  } else if (ext === "html") {
    const { minify } = await import("html-minifier-terser");
    compressed = await minify(contents, {
      collapseWhitespace: true,
      removeComments: true,
      conservativeCollapse: true,
      minifyCSS: false, // Disabled to avoid sub-dependency issues in Deno
      minifyJS: false,
    });
  } else {
    throw new Error(`Unsupported type for compression: .${ext}`);
  }

  const { ensureFile } = await import("std/fs/mod.ts");
  await ensureFile(outputPath);
  await Deno.writeTextFile(outputPath, compressed);
}
