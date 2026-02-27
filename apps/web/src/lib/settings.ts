export const WIT_AI_API_KEYS_STORAGE_KEY = 'bpb.witAiApiKeys';

export function parseWitAiApiKeysInput(value: string): string[] {
    return Array.from(
        new Set(
            value
                .split(/\s+/)
                .map((part) => part.trim())
                .filter((part) => part.length > 0),
        ),
    );
}

export function readWitAiApiKeysInput(): string {
    if (typeof window === 'undefined') {
        return '';
    }
    return window.localStorage.getItem(WIT_AI_API_KEYS_STORAGE_KEY) ?? '';
}

export function writeWitAiApiKeysInput(value: string): void {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(WIT_AI_API_KEYS_STORAGE_KEY, value.trim());
}
