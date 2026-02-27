import { IconLoader, IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDashboard } from '@/context/dashboard-context';
import { type CreateJobRequest, createJob } from '@/lib/api';
import { FALLBACK_OPTIONS } from '@/lib/fallback-options';
import { parseWitAiApiKeysInput, readWitAiApiKeysInput } from '@/lib/settings';

type FormState = {
    input: string;
    engine: 'whisperx' | 'tafrigh';
    language: string;
    modelPath: string;
    enhancementMode: 'off' | 'auto' | 'on' | 'analyze-only';
    outputFormats: string[];
    force: boolean;
};

export function NewJobRoute() {
    const navigate = useNavigate();
    const { optionsQuery, refreshAll } = useDashboard();
    const options = optionsQuery.data ?? FALLBACK_OPTIONS;
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>({
        engine: options.defaults.engine,
        enhancementMode: options.defaults.enhancementMode,
        force: false,
        input: '',
        language: options.defaults.language,
        modelPath: options.defaults.modelPath,
        outputFormats: options.defaults.outputFormats,
    });

    const createJobMutation = useMutation({
        mutationFn: async (payloads: CreateJobRequest[]) => {
            const results = [];
            for (const payload of payloads) {
                results.push(await createJob(payload));
            }
            return results;
        },
        onError: (error) => {
            setSubmitError(error instanceof Error ? error.message : String(error));
        },
        onSuccess: () => {
            setSubmitError(null);
            setForm((previous) => ({ ...previous, input: '' }));
            refreshAll();
            navigate('/job-queue');
        },
    });

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const inputs = Array.from(
            new Set(
                form.input
                    .split('\n')
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0),
            ),
        );
        if (inputs.length === 0) {
            setSubmitError('Input is required.');
            return;
        }
        if (form.outputFormats.length === 0) {
            setSubmitError('At least one output format is required.');
            return;
        }
        const witAiApiKeys = parseWitAiApiKeysInput(readWitAiApiKeysInput());
        if (form.engine === 'tafrigh' && witAiApiKeys.length === 0) {
            setSubmitError('Tafrigh requires Wit.ai API keys. Add them in Settings.');
            return;
        }

        const payloads: CreateJobRequest[] = inputs.map((input) => ({
            force: form.force,
            input,
            overrides: {
                engine: form.engine,
                enhancementMode: form.enhancementMode,
                language: form.language,
                modelPath: form.modelPath,
                outputFormats: form.outputFormats,
                witAiApiKeys,
            },
        }));
        createJobMutation.mutate(payloads);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Run a New Transcription Job</CardTitle>
                <CardDescription>Submit local paths, YouTube URLs, playlists, or channel links.</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="grid gap-4" onSubmit={handleSubmit}>
                    <div className="grid gap-2">
                        <Label htmlFor="input">Input URL or local path</Label>
                        <Textarea
                            id="input"
                            placeholder={
                                'https://www.youtube.com/watch?v=...\nhttps://www.youtube.com/watch?v=...\n/path/to/local-file.mp3'
                            }
                            rows={6}
                            value={form.input}
                            onChange={(event) => setForm((previous) => ({ ...previous, input: event.target.value }))}
                        />
                        <p className="text-muted-foreground text-xs">Paste one URL/path per line.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                        <div className="grid gap-2">
                            <Label>Engine</Label>
                            <Select
                                value={form.engine}
                                onValueChange={(value) =>
                                    setForm((previous) => ({
                                        ...previous,
                                        engine: value as FormState['engine'],
                                    }))
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.engines.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Language</Label>
                            <Select
                                value={form.language}
                                onValueChange={(value) => setForm((previous) => ({ ...previous, language: value }))}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.languages.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {form.engine === 'whisperx' ? (
                            <div className="grid gap-2">
                                <Label>Whisper model</Label>
                                <Select
                                    value={form.modelPath}
                                    onValueChange={(value) =>
                                        setForm((previous) => ({ ...previous, modelPath: value }))
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.models.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : (
                            <div className="grid gap-2">
                                <Label>Model</Label>
                                <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
                                    Tafrigh manages model selection internally.
                                </div>
                            </div>
                        )}
                        <div className="grid gap-2">
                            <Label>Enhancement mode</Label>
                            <Select
                                value={form.enhancementMode}
                                onValueChange={(value) =>
                                    setForm((previous) => ({
                                        ...previous,
                                        enhancementMode: value as FormState['enhancementMode'],
                                    }))
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.enhancementModes.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="grid gap-2 md:col-span-2">
                            <Label>Output formats</Label>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button className="justify-between" type="button" variant="outline">
                                        <span>
                                            {form.outputFormats.length > 0
                                                ? form.outputFormats.join(', ')
                                                : 'Select formats'}
                                        </span>
                                        <span className="text-muted-foreground text-xs">
                                            {form.outputFormats.length} selected
                                        </span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-[18rem]">
                                    {options.outputFormats.map((option) => {
                                        const checked = form.outputFormats.includes(option.value);
                                        return (
                                            <DropdownMenuCheckboxItem
                                                checked={checked}
                                                key={option.value}
                                                onCheckedChange={(nextChecked) =>
                                                    setForm((previous) => ({
                                                        ...previous,
                                                        outputFormats: nextChecked
                                                            ? Array.from(
                                                                  new Set([...previous.outputFormats, option.value]),
                                                              )
                                                            : previous.outputFormats.filter(
                                                                  (value) => value !== option.value,
                                                              ),
                                                    }))
                                                }
                                            >
                                                {option.label}
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <div className="flex items-end pb-0.5">
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    checked={form.force}
                                    id="force"
                                    onCheckedChange={(checked) =>
                                        setForm((previous) => ({ ...previous, force: checked === true }))
                                    }
                                />
                                <Label className="cursor-pointer font-normal" htmlFor="force">
                                    Force overwrite
                                </Label>
                            </div>
                        </div>
                    </div>
                    {submitError ? (
                        <Alert variant="destructive">
                            <AlertTitle>Submission failed</AlertTitle>
                            <AlertDescription>{submitError}</AlertDescription>
                        </Alert>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button className="gap-2" disabled={createJobMutation.isPending} type="submit">
                            {createJobMutation.isPending ? (
                                <IconLoader className="size-4 animate-spin" />
                            ) : (
                                <IconPlayerPlay className="size-4" />
                            )}
                            Start job
                        </Button>
                        <Button className="gap-2" onClick={refreshAll} type="button" variant="outline">
                            <IconRefresh className="size-4" />
                            Refresh
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
