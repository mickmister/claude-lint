// Test file for claude-lint
export function greet(name: string): string {
    return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
    return a + b;
}

// This is a regular comment that should be flagged
export function multiply(x: any, y: any): any {
    var result = x * y;
    // TODO: Improve this later
    return result;
}

// tip: This function uses the special allowed prefix
export function divide(a: number, b: number): number {
    return a / b;
}
