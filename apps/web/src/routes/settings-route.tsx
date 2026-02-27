import { IconDeviceFloppy } from '@tabler/icons-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseWitAiApiKeysInput, readWitAiApiKeysInput, writeWitAiApiKeysInput } from '@/lib/settings';

export function SettingsRoute() {
    const [witAiKeysInput, setWitAiKeysInput] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setWitAiKeysInput(readWitAiApiKeysInput());
    }, []);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        writeWitAiApiKeysInput(witAiKeysInput);
        setSaved(true);
    };

    const normalizedKeys = parseWitAiApiKeysInput(witAiKeysInput);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Settings</CardTitle>
                <CardDescription>Configure client-side values used when creating transcription jobs.</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="grid gap-4" onSubmit={handleSubmit}>
                    <div className="grid gap-2">
                        <Label htmlFor="wit-ai-api-keys">Wit.ai API keys</Label>
                        <Textarea
                            id="wit-ai-api-keys"
                            onChange={(event) => {
                                setSaved(false);
                                setWitAiKeysInput(event.target.value);
                            }}
                            placeholder="token_1 token_2 token_3"
                            rows={5}
                            value={witAiKeysInput}
                        />
                        <p className="text-muted-foreground text-xs">
                            Paste one or more keys separated by spaces. These are sent with Tafrigh jobs.
                        </p>
                        <p className="text-muted-foreground text-xs">Detected keys: {normalizedKeys.length}</p>
                    </div>
                    {saved ? (
                        <Alert>
                            <AlertTitle>Saved</AlertTitle>
                            <AlertDescription>Wit.ai keys updated for future job submissions.</AlertDescription>
                        </Alert>
                    ) : null}
                    <div>
                        <Button className="gap-2" type="submit">
                            <IconDeviceFloppy className="size-4" />
                            Save settings
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
