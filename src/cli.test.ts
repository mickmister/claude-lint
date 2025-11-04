import {describe, it, expect} from "vitest";
import { parseArgs } from "./cli.js";

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
