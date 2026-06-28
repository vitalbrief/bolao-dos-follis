# Bolao dos Follis

Site estatico para acompanhar o Bolao dos Follis na Copa do Mundo 2026.

Producao: https://bolao-dos-follis.pages.dev/

## Fluxo de atualizacao

1. Exporte o CSV do Google Forms.
2. Substitua o CSV bruto local da fase correspondente:
   - Fase de grupos: `data/raw/group-stage-current.csv`
   - 16 avos: `data/raw/round-of-32-current.csv`
3. Ajuste nomes em `data/manual/people.json`, se alguem preencher diferente.
4. Cadastre nomes que devem ser ignorados em `data/manual/ignored-people.json`, se houver.
5. Ajuste correcoes manuais de palpites em `data/manual/prediction-overrides.json`, se houver.
6. Atualize resultados em `data/manual/tournament.json`.
7. Rode:

```bash
npm test
npm run build
```

8. Confira o site local:

```bash
npm run dev
```

Abra `http://localhost:4173`.

Para regenerar a imagem que aparece ao compartilhar no WhatsApp:

```bash
npm run social:image
```

9. **Publique** comitando o JSON gerado e dando push. O Cloudflare Pages faz o deploy automaticamente:

```bash
git add site/data/site-data.json data/manual
git commit -m "Atualiza rodada"
git push
```

> ⚠️ **Importante:** o deploy do Cloudflare Pages usa a pasta `site/` como está. O CSV bruto fica fora do Git, então o site só muda se você rodar `npm run build` localmente e comitar o `site/data/site-data.json` atualizado. Se editar `tournament.json` e der push sem rebuildar, o site continua igual.

## Dados

- `data/raw/`: CSVs brutos locais, ignorados pelo Git.
- `data/manual/`: configuracoes editaveis, nomes, aliases, correcoes manuais e resultados.
- `site/data/site-data.json`: JSON limpo publicado no site.

## Publicacao

O Cloudflare Pages publica a pasta `site/`.

Configuracao recomendada:

- Project name: `bolao-dos-follis`
- Production branch: `main`
- Build command: vazio
- Build output directory: `site`
