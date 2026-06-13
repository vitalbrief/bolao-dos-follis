# Bolao dos Follis

Site estatico para acompanhar o Bolao dos Follis na Copa do Mundo 2026.

## Fluxo de atualizacao

1. Exporte o CSV do Google Forms.
2. Substitua `data/raw/group-stage-current.csv`.
3. Ajuste nomes em `data/manual/people.json`, se alguem preencher diferente.
4. Atualize resultados em `data/manual/tournament.json`.
5. Rode:

```bash
npm test
npm run build
```

6. Confira o site local:

```bash
npm run dev
```

Abra `http://localhost:4173`.

7. **Publique** comitando o JSON gerado e dando push:

```bash
git add site/data/site-data.json data/manual
git commit -m "Atualiza rodada"
git push
```

> ⚠️ **Importante:** o workflow do GitHub Pages **não roda o `npm run build`** — ele só envia a pasta `site/` como está. O CSV bruto fica fora do Git, então o site só muda se você rodar `npm run build` localmente e comitar o `site/data/site-data.json` atualizado. Se editar `tournament.json` e der push sem rebuildar, o site continua igual.

## Dados

- `data/raw/`: CSVs brutos locais, ignorados pelo Git.
- `data/manual/`: configuracoes editaveis, nomes, aliases e resultados.
- `site/data/site-data.json`: JSON limpo publicado no site.

## Publicacao

O workflow em `.github/workflows/pages.yml` publica apenas a pasta `site/` no GitHub Pages.
