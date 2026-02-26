import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createFakeWhisperx(binDir: string): Promise<string> {
    const binPath = join(binDir, 'fake-whisperx');
    const script = `#!/usr/bin/env sh
set -e

if [ "$#" -gt 0 ] && [ "$1" = "--version" ]; then
  echo "whisperx 0.0-test"
  exit 0
fi

if [ "$#" -gt 0 ] && [ "$1" = "--help" ]; then
  echo "fake whisperx"
  exit 0
fi

audio_path=""
output_dir=""
language_arg=""
compute_type_arg=""
batch_size_arg=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output_dir)
      output_dir="$2"
      shift 2
      ;;
    --language)
      language_arg="$2"
      shift 2
      ;;
    --compute_type)
      compute_type_arg="$2"
      shift 2
      ;;
    --batch_size)
      batch_size_arg="$2"
      shift 2
      ;;
    --*)
      shift 2
      ;;
    *)
      if [ -z "$audio_path" ]; then
        audio_path="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$audio_path" ] || [ -z "$output_dir" ]; then
  echo "missing audio path or output_dir" >&2
  exit 2
fi

stem="$(basename "$audio_path")"
stem="\${stem%.*}"
mkdir -p "$output_dir"

cat > "$output_dir/$stem.txt" <<'EOF'
Assalamu alaikum
EOF

cat > "$output_dir/$stem.json" <<'EOF'
{"language":"ar","params":{"language_arg":"__LANG_ARG__","compute_type_arg":"__COMPUTE_TYPE_ARG__","batch_size_arg":"__BATCH_SIZE_ARG__"},"segments":[{"start":0.0,"end":0.6,"text":"Assalamu alaikum","words":[{"word":"Assalamu","start":0.0,"end":0.3},{"word":"alaikum","start":0.3,"end":0.6}]}]}
EOF

escaped_language_arg="$(printf '%s' "$language_arg" | sed 's/[\\/&]/\\\\&/g')"
escaped_compute_type_arg="$(printf '%s' "$compute_type_arg" | sed 's/[\\/&]/\\\\&/g')"
escaped_batch_size_arg="$(printf '%s' "$batch_size_arg" | sed 's/[\\/&]/\\\\&/g')"
sed -i.bak "s/__LANG_ARG__/$escaped_language_arg/g" "$output_dir/$stem.json"
sed -i.bak "s/__COMPUTE_TYPE_ARG__/$escaped_compute_type_arg/g" "$output_dir/$stem.json"
sed -i.bak "s/__BATCH_SIZE_ARG__/$escaped_batch_size_arg/g" "$output_dir/$stem.json"
rm -f "$output_dir/$stem.json.bak"
`;
    await writeFile(binPath, script, 'utf-8');
    await chmod(binPath, 0o755);
    return binPath;
}
