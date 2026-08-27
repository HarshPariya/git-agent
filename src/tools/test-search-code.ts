import {
  searchCode,
} from "./search-code.js";

async function main() {
  const query =
    process.argv.slice(2).join(" ") ||
    "Where is normalizeId used?";

  console.log();
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
  console.log("SEARCH CODE TOOL");
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log();
  console.log(`Query: "${query}"`);
  console.log();

  const output =
    await searchCode({
      query,
      limit: 6,
    });

  for (
    const result
    of output.results
  ) {
    console.log(
      `${result.rank}. ${result.name}`,
    );

    console.log(
      `   Score: ${result.score.toFixed(4)}`,
    );

    console.log(
      `   Sources: ${result.sources.join(" + ")}`,
    );

    if (result.filePath) {
      console.log(
        `   File: ${result.filePath}`,
      );
    }

    if (
      result.startLine !== undefined &&
      result.endLine !== undefined
    ) {
      console.log(
        `   Lines: ${result.startLine}-${result.endLine}`,
      );
    }

    if (result.content) {
      console.log();
      console.log("   Preview:");
      console.log(
        result.content
          .split(/\r?\n/)
          .slice(0, 6)
          .map(
            (line) =>
              `   ${line}`,
          )
          .join("\n"),
      );
    }

    console.log();
  }
}

main().catch((error) => {
  console.error(
    "search-code tool failed:",
  );

  console.error(error);

  process.exit(1);
});
