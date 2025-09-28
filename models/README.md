# Vosk Models Directory

This directory is where you should place your downloaded Vosk speech recognition models.

## Downloading Models

1. Visit [Vosk Models](https://alphacephei.com/vosk/models)
2. Choose a model for your language:
   - **English**: `vosk-model-en-us-0.22` (recommended, ~50MB)
   - **Small English**: `vosk-model-small-en-us-0.15` (lighter, ~40MB)
   - **Large English**: `vosk-model-en-us-0.22-lgraph` (better accuracy, ~130MB)

3. Download and extract the model to this directory

## Example Structure

After downloading and extracting, your directory should look like:

```
models/
├── README.md (this file)
└── vosk-model-en-us-0.22/
    ├── am/
    ├── conf/
    ├── graph/
    ├── ivector/
    └── README
```

## Model Configuration

Update the `modelPath` in your transcriber configuration to point to your model:

```typescript
const transcriber = createTranscriber({
  engine: {
    engine: 'vosk',
    language: 'en',
    modelPath: './models/vosk-model-en-us-0.22'
  }
});
```

## Supported Languages

Vosk supports 20+ languages. Popular models include:
- English (en): `vosk-model-en-us-0.22`
- French (fr): `vosk-model-fr-0.22`
- German (de): `vosk-model-de-0.21`
- Spanish (es): `vosk-model-es-0.22`
- Russian (ru): `vosk-model-ru-0.22`
- Chinese (zh): `vosk-model-cn-0.22`

For the complete list, visit [https://alphacephei.com/vosk/models](https://alphacephei.com/vosk/models)