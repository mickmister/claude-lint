import {describe, it, expect} from "vitest";
import {
    parseArgs,
    parseRulesCsv,
    isWebFile,
    virtFromReal,
    uniq,
    computeAdded,
    inRanges,
    type Range,
} from "./cli.js";

describe("parseArgs", () => {
    it("should parse subcommand", () => {
        const result = parseArgs(["node", "cli.js", "record"]);
        expect(result.sub).toBe("record");
        expect(result.flags).toEqual({});
        expect(result.positional).toEqual([]);
    });

    it("should default to help when no subcommand", () => {
        const result = parseArgs(["node", "cli.js"]);
        expect(result.sub).toBe("help");
    });

    it("should parse boolean flags", () => {
        const result = parseArgs(["node", "cli.js", "finalize", "--verbose", "--no-eslintrc"]);
        expect(result.sub).toBe("finalize");
        expect(result.flags).toEqual({verbose: true, "no-eslintrc": true});
    });

    it("should parse flags with values", () => {
        const result = parseArgs(["node", "cli.js", "record", "--file", "test.ts"]);
        expect(result.flags).toEqual({file: "test.ts"});
    });

    it("should parse flags with equals syntax", () => {
        const result = parseArgs(["node", "cli.js", "finalize", "--config=./config.json"]);
        expect(result.flags).toEqual({config: "./config.json"});
    });

    it("should parse mixed flags and positionals", () => {
        const result = parseArgs(["node", "cli.js", "test", "--verbose", "--file", "test.ts", "arg1", "arg2"]);
        expect(result.sub).toBe("test");
        expect(result.flags).toEqual({verbose: true, file: "test.ts"});
        expect(result.positional).toEqual(["arg1", "arg2"]);
    });
});

describe("parseRulesCsv", () => {
    it("should return empty object for undefined", () => {
        expect(parseRulesCsv()).toEqual({});
    });

    it("should return empty object for empty string", () => {
        expect(parseRulesCsv("")).toEqual({});
    });

    it("should parse simple error/warn rules", () => {
        const result = parseRulesCsv("no-var:error,semi:warn");
        expect(result).toEqual({
            "no-var": 2,
            "semi": 1,
        });
    });

    it("should parse numeric severity levels", () => {
        const result = parseRulesCsv("no-var:2,semi:1,no-console:0");
        expect(result).toEqual({
            "no-var": 2,
            "semi": 1,
            "no-console": 0,
        });
    });

    it("should parse JSON array configurations", () => {
        const result = parseRulesCsv('quotes:["error","single"]');
        expect(result).toEqual({
            quotes: ["error", "single"],
        });
    });

    it("should parse JSON object configurations", () => {
        const result = parseRulesCsv('no-unused-vars:["error",{"vars":"all"}]');
        expect(result).toEqual({
            "no-unused-vars": ["error", {vars: "all"}],
        });
    });

    it("should handle multiple rules with complex configs", () => {
        const result = parseRulesCsv('no-var:error,quotes:["error","single"],semi:warn');
        expect(result).toEqual({
            "no-var": 2,
            quotes: ["error", "single"],
            semi: 1,
        });
    });

    it("should handle whitespace in CSV", () => {
        const result = parseRulesCsv("no-var: error , semi: warn");
        expect(result).toEqual({
            "no-var": 2,
            semi: 1,
        });
    });
});

describe("isWebFile", () => {
    it("should return true for .js files", () => {
        expect(isWebFile("test.js")).toBe(true);
        expect(isWebFile("path/to/file.js")).toBe(true);
    });

    it("should return true for .ts files", () => {
        expect(isWebFile("test.ts")).toBe(true);
    });

    it("should return true for .jsx files", () => {
        expect(isWebFile("component.jsx")).toBe(true);
    });

    it("should return true for .tsx files", () => {
        expect(isWebFile("component.tsx")).toBe(true);
    });

    it("should return false for non-web files", () => {
        expect(isWebFile("readme.md")).toBe(false);
        expect(isWebFile("config.json")).toBe(false);
        expect(isWebFile("style.css")).toBe(false);
        expect(isWebFile("test.py")).toBe(false);
    });

    it("should return false for files without extension", () => {
        expect(isWebFile("Makefile")).toBe(false);
    });
});

describe("virtFromReal", () => {
    it("should return snippet.tsx for .tsx files", () => {
        expect(virtFromReal("component.tsx")).toBe("snippet.tsx");
        expect(virtFromReal("path/to/component.tsx")).toBe("snippet.tsx");
    });

    it("should return snippet.ts for .ts files", () => {
        expect(virtFromReal("module.ts")).toBe("snippet.ts");
    });

    it("should return snippet.jsx for .jsx files", () => {
        expect(virtFromReal("component.jsx")).toBe("snippet.jsx");
    });

    it("should return snippet.js for .js files", () => {
        expect(virtFromReal("script.js")).toBe("snippet.js");
    });

    it("should return snippet.js for unknown extensions", () => {
        expect(virtFromReal("file.unknown")).toBe("snippet.js");
        expect(virtFromReal("noext")).toBe("snippet.js");
    });
});

describe("uniq", () => {
    it("should remove duplicates from array", () => {
        expect(uniq([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4]);
    });

    it("should work with strings", () => {
        expect(uniq(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
    });

    it("should return empty array for empty input", () => {
        expect(uniq([])).toEqual([]);
    });

    it("should preserve order of first occurrence", () => {
        expect(uniq([3, 1, 2, 1, 3])).toEqual([3, 1, 2]);
    });
});

describe("computeAdded", () => {
    it("should detect added lines at the beginning", () => {
        const before = "line2\nline3";
        const after = "line1\nline2\nline3";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([{start: 1, end: 1}]);
        expect(result.snippet).toBe("line1");
    });

    it("should detect added lines in the middle", () => {
        const before = "line1\nline3";
        const after = "line1\nline2\nline3";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([{start: 2, end: 2}]);
        expect(result.snippet).toBe("line2");
    });

    it("should detect added lines at the end", () => {
        const before = "line1\nline2\n";
        const after = "line1\nline2\nline3\n";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([{start: 3, end: 3}]);
        expect(result.snippet).toBe("line3");
    });

    it("should detect multiple added blocks", () => {
        const before = "line1\nline4\n";
        const after = "line1\nline2\nline3\nline4\nline5\n";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([
            {start: 2, end: 3},
            {start: 5, end: 5},
        ]);
        expect(result.snippet).toBe("line2\nline3\nline5");
    });

    it("should return empty ranges when nothing added", () => {
        const before = "line1\nline2";
        const after = "line1\nline2";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([]);
        expect(result.snippet).toBe("");
    });

    it("should handle only deletions", () => {
        const before = "line1\nline2\nline3";
        const after = "line1\nline3";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([]);
        expect(result.snippet).toBe("");
    });

    it("should handle empty before (all new)", () => {
        const before = "";
        const after = "line1\nline2";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([{start: 1, end: 2}]);
        expect(result.snippet).toBe("line1\nline2");
    });

    it("should handle multi-line additions", () => {
        const before = "line1\nline5";
        const after = "line1\nline2\nline3\nline4\nline5";
        const result = computeAdded(before, after);
        expect(result.ranges).toEqual([{start: 2, end: 4}]);
        expect(result.snippet).toBe("line2\nline3\nline4");
    });
});

describe("inRanges", () => {
    const ranges: Range[] = [
        {start: 1, end: 3},
        {start: 10, end: 15},
        {start: 20, end: 20},
    ];

    it("should return true for lines in first range", () => {
        expect(inRanges(1, ranges)).toBe(true);
        expect(inRanges(2, ranges)).toBe(true);
        expect(inRanges(3, ranges)).toBe(true);
    });

    it("should return true for lines in second range", () => {
        expect(inRanges(10, ranges)).toBe(true);
        expect(inRanges(12, ranges)).toBe(true);
        expect(inRanges(15, ranges)).toBe(true);
    });

    it("should return true for single-line range", () => {
        expect(inRanges(20, ranges)).toBe(true);
    });

    it("should return false for lines outside ranges", () => {
        expect(inRanges(0, ranges)).toBe(false);
        expect(inRanges(4, ranges)).toBe(false);
        expect(inRanges(9, ranges)).toBe(false);
        expect(inRanges(16, ranges)).toBe(false);
        expect(inRanges(21, ranges)).toBe(false);
        expect(inRanges(100, ranges)).toBe(false);
    });

    it("should return false for empty ranges", () => {
        expect(inRanges(1, [])).toBe(false);
    });
});
