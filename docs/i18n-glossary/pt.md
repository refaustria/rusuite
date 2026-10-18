# Glossary: Portuguese, Portugal (`pt`, pt-PT)

Source: Microsoft Office European Portuguese (Portugal) localisation (Word, Excel, PowerPoint 365 ribbon, dialogs, Microsoft's terminology portal). Translator: P9-L2. Reviewer: P9-LR1 (2026-10-17).

## Register
- Address: informal "tu / te / teu / tua" with second-person verbs and imperatives ("Guarda", "Clica", "Introduz", "Seleciona", "Tenta novamente"); never "você", "o senhor / a senhora" or the third-person imperative ("Guarde", "Clique", "Introduza").
- Third-person "seu/sua/seus/suas" is used only for the possessions of a thing ("as suas células", "o seu esquema"), never for the user; "o seu PC" appears only inside a quoted Windows dialog title.
- Buttons and menu commands: infinitive or noun as Office does ("Guardar", "Abrir", "Inserir", "Eliminar"); ribbon group labels are nouns.
- European spelling and vocabulary (pt-PT, Acordo Ortográfico): "ficheiro", "ecrã", "rato", "utilizador", "palavra-passe", "navegador", "carateres", "diapositivo", "Guardar", "Ligação", "Anular/Refazer", "Tipo de Letra". No Brazilian terms (arquivo, tela, mouse, salvar).
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names (packages/ui-shared/src/i18n/keyNames.ts): Portuguese Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter), so no `KEY_NAMES` entry is added.
- Formula language stays English (SUM, TRUE, `#REF!`); only prose around it is translated.
- Plural categories: `one / many / other`; `many` (millions) puts "de" before the noun ("{count} de páginas" = "1 000 000 de páginas"); unit abbreviations ("há {count} h") stay as in `other`.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Ficheiro | |
| Home | Base | |
| Insert | Inserir | |
| Draw | Desenhar | |
| Design | Estrutura | Word/PowerPoint "Estrutura"; tools tabs "Estrutura da Tabela/do Gráfico" |
| Layout | Esquema | Calc: Esquema de Página |
| References | Referências | Write |
| Mailings | Correspondência | Write |
| Review | Rever | Excel/PowerPoint "Rever", Word "Revisão" for the noun |
| View | Ver | |
| Formulas | Fórmulas | Calc |
| Data | Dados | Calc |
| Transitions | Transições | Show |
| Animations | Animações | Show |
| Slide Show | Apresentação de Diapositivos | Show |
| Help | Ajuda | |
| Picture / Table / Chart / Drawing Tools | Ferramentas de Imagem / Tabela / Gráfico / Desenho | contextual |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Área de Transferência | |
| Font | Tipo de Letra | |
| Paragraph | Parágrafo | |
| Styles | Estilos | |
| Editing | Edição | |
| Number | Número | Calc |
| Alignment | Alinhamento | Calc |
| Cells | Células | Calc |
| Slides | Diapositivos | Show |
| Drawing | Desenho | Show |
| Zoom | Zoom | |
| Show (View › Show) | Mostrar | |
| Language | Idioma / Language | picker label |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Novo | |
| Open… | Abrir… | |
| Save | Guardar | pt-PT, not "Salvar" |
| Save As… | Guardar Como… | |
| Print | Imprimir | |
| Export PDF… | Exportar PDF… | |
| Close | Fechar | |
| Options… | Opções… | |
| Undo / Redo | Anular / Refazer | |
| Cut / Copy / Paste | Cortar / Copiar / Colar | |
| Paste Special… | Colar Especial… | |
| Format Painter | Pincel de formatação | |
| Find / Replace… / Go To… | Localizar / Substituir… / Ir para… | |
| Select All | Selecionar tudo | |
| Bold / Italic / Underline / Strikethrough | Negrito / Itálico / Sublinhado / Rasurado | |
| Font Color / Highlight / Fill Color | Cor do tipo de letra / Realce / Cor de preenchimento | |
| Insert Picture / Table / Chart / Shape / Text Box | Imagem / Tabela / Gráfico / Forma / Caixa de Texto | |
| Bring to Front / Send to Back | Trazer para a Frente / Enviar para Trás | |
| Group / Ungroup | Agrupar / Desagrupar | |
| Sort / Filter | Ordenar / Filtrar | Calc |
| Insert Function | Inserir Função | Calc |
| New Slide | Novo Diapositivo | Show |
| From Beginning / From Current Slide | Desde o Início / A Partir do Diapositivo Atual | Show |
| Track Changes / Comments | Registar Alterações / Comentários | Write |
| Merge & Center | Intercalar e Centrar | |
| Freeze Panes | Congelar Painéis | |
| Conditional Formatting | Formatação Condicional | |
| Data Validation | Validação de Dados | |
| Flash Fill | Preenchimento Relâmpago | |
| Goal Seek | Atingir Objetivo | |
| PivotTable / PivotChart | Tabela Dinâmica / Gráfico Dinâmico | |
| Slicer | Segmentação de Dados | |
| Header & Footer | Cabeçalho e Rodapé | |
| Table of Contents | Índice | |
| Footnote / Endnote | Nota de Rodapé / Nota Final | |
| Cross-reference | Referência cruzada | |
| Bookmark | Marcador | |
| Hyperlink | Hiperligação | |
| Page Setup | Configurar Página | |
| Print Preview | Pré-visualização de Impressão | |
| Speaker notes | Notas do orador | |
| Presenter view | Vista do apresentador | |
| Slide Master | Modelo de Diapositivos | |
| Slide Sorter | Ordenação de Diapositivos | |
| Section | Secção | |
| Report a problem… | Comunicar um problema… | |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR1), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Copiar | `ai.pane.copy` |
| Save | Guardar | `ai.settings.save` |
| Insert | Inserir | `ai.write.insert` |
| Close | Fechar | `backstage.close` |
| New | Novo | `backstage.new` |
| Open… | Abrir… | `backstage.open` |
| Options… | Opções… | `backstage.options` |
| Print | Imprimir | `backstage.print` |
| Save As… | Guardar Como… | `backstage.saveAs` |
| Cut | Cortar | `cmd.cut` |
| Delete | Eliminar | `cmd.delete` |
| Find | Localizar | `cmd.find` |
| Paste | Colar | `cmd.paste` |
| Redo | Refazer | `cmd.redo` |
| Replace… | Substituir… | `cmd.replaceDots` |
| Undo | Anular | `cmd.undo` |
| Size | Tamanho | `conn.browser.colSize` |
| Rename | Mudar o nome | `conn.browser.rename` |
| Bold | Negrito | `fmt.bold` |
| Borders | Limites | `fmt.borders` |
| Colors | Cores | `fmt.colors` |
| Italic | Itálico | `fmt.italic` |
| Strikethrough | Rasurado | `fmt.strike` |
| Underline | Sublinhado | `fmt.underline` |
| Zoom | Zoom | `group.zoom` |
| Layout | Esquema | `print.layoutSection` |
| Margins | Margens | `print.margins` |
| Normal | Normais | `print.margins.normal` |
| Orientation | Orientação | `print.orientation` |
| Format | Formatar | `sc.format` |
| Remove Arrows | Remover Setas | `calc.audit.removeArrows` |
| Show Formulas | Mostrar Fórmulas | `calc.audit.showFormulas` |
| Trace Dependents | Localizar Dependentes | `calc.audit.traceDependents` |
| Trace Precedents | Localizar Precedentes | `calc.audit.tracePrecedents` |
| Breaks | Quebras | `calc.breaks` |
| Fill | Preenchimento | `calc.cf.barFill` |
| Clear | Limpar | `calc.cf.clearFormat` |
| Shapes | Formas | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Formatação Condicional | `calc.cf.menu` |
| Gridlines | Linhas de Grelha | `calc.chart.ae.gridlines` |
| Chart | Gráfico | `calc.chart.chart` |
| Center | Centro | `calc.chart.pos.center` |
| Recommended Charts | Gráficos Recomendados | `calc.chart.recommended` |
| Shape Fill | Preenchimento da Forma | `calc.chart.shapeFill` |
| Shape Outline | Contorno da Forma | `calc.chart.shapeOutline` |
| New Comment | Novo Comentário | `calc.comments.new` |
| Comment | Comentário | `calc.comments.textLabel` |
| Consolidate | Consolidar | `calc.consolidate.button` |
| Delete Cells… | Eliminar Células… | `calc.deleteCellsDots` |
| Remove Duplicates | Remover Duplicados | `calc.dup.button` |
| Columns | Colunas | `calc.dup.columns` |
| Select All | Selecionar Tudo | `calc.dup.selectAll` |
| Data Validation | Validação de Dados | `calc.dv.button` |
| Filter | Filtrar | `calc.filter` |
| Font Color | Cor do Tipo de Letra | `calc.filter.byFontColor` |
| Flash Fill | Preenchimento Relâmpago | `calc.flash.button` |
| Effects | Efeitos | `calc.fmt.effects` |
| Justify | Justificar | `calc.fmt.h.justify` |
| Indent | Avanço | `calc.fmt.indent` |
| Preview | Pré-visualização | `calc.fmt.preview` |
| Subscript | Subscrito | `calc.fmt.subscript` |
| Superscript | Sobrescrito | `calc.fmt.superscript` |
| Symbol | Símbolo | `calc.fmt.symbol` |
| AutoSum | Soma Automática | `calc.fn.autoSum` |
| Insert Function | Inserir Função | `calc.fn.insert` |
| Format Painter | Pincel de formatação | `calc.formatPainter` |
| Freeze Panes | Congelar Painéis | `calc.freezePanes` |
| Goal Seek… | Atingir Objetivo… | `calc.goal.dots` |
| What-If Analysis | Análise de Hipóteses | `calc.goal.whatIf` |
| Hide | Ocultar | `calc.hide` |
| Insert Cells… | Inserir Células… | `calc.insertCellsDots` |
| Link | Ligação | `calc.link.button` |
| Merge Cells | Intercalar Células | `calc.mergeCells` |
| Merge & Center | Intercalar e Centrar | `calc.mergeCenter` |
| Move or Copy… | Mover ou Copiar… | `calc.moveCopy.dots` |
| Define Name | Definir Nome | `calc.names.define` |
| Name Manager | Gestor de Nomes | `calc.names.manager` |
| Group | Agrupar | `calc.outline.group` |
| Ungroup | Desagrupar | `calc.outline.ungroup` |
| Page Setup | Configurar Página | `calc.pageSetup` |
| Pictures | Imagens | `calc.picture.button` |
| PivotTable | Tabela Dinâmica | `calc.pivot.pivotTable` |
| Refresh All | Atualizar Tudo | `calc.pivot.refreshAll` |
| Styles | Estilos | `calc.pivot.stylesGallery` |
| Print Area | Área de Impressão | `calc.printArea` |
| Print Titles | Imprimir Títulos | `calc.printTitles` |
| Sort | Ordenar | `calc.protect.allow.sort` |
| Protect Workbook | Proteger Livro | `calc.protect.bookDots` |
| Protect Sheet… | Proteger Folha… | `calc.protect.sheetDots` |
| Paste Special… | Colar Especial… | `calc.ps.dots` |
| Error Checking | Verificação de Erros | `calc.err.dialogTitle` |
| Previous | Anterior | `calc.err.previous` |
| Next | Seguinte | `calc.err.next` |
| Evaluate Formula | Avaliar Fórmula | `calc.eval.title` |
| Watch Window | Janela de Monitorização | `calc.watch.title` |
| Calculate Now | Calcular Agora | `calc.calc.now` |
| Sort & Filter | Ordenar e Filtrar | `calc.sortFilter` |
| Subtotal | Subtotal | `calc.subtotal.button` |
| Properties | Propriedades | `calc.table.properties` |
| Table | Tabela | `calc.table.table` |
| Unhide | Mostrar | `calc.unhide` |
| Text to Columns | Texto para Colunas | `calc.wizard.ttcButton` |
| Align Left | Alinhar à Esquerda | `write.alignObj.left` |
| Align Right | Alinhar à Direita | `write.alignObj.right` |
| Align | Alinhar | `write.alignObjects` |
| Bookmark | Marcador | `write.bookmark.button` |
| Insert Caption | Inserir Legenda | `write.caption.button` |
| Equation | Equação | `write.caption.equation` |
| Position | Posição | `write.caption.position` |
| Crop | Recortar | `write.crop` |
| Spacing | Espaçamento | `write.font.spacing` |
| Bring Forward | Avançar | `write.order.bringForward` |
| Bring to Front | Trazer para a Frente | `write.order.bringToFront` |
| Send Backward | Recuar | `write.order.sendBackward` |
| Send to Back | Enviar para Trás | `write.order.sendToBack` |
| Picture | Imagem | `write.picture` |
| Section | Secção | `write.reveal.section` |
| Rotate | Rodar | `write.rotate` |
| Ruler | Régua | `write.ruler` |
| Selection Pane | Painel de Seleção | `write.selectionPane` |
| Spelling | Ortografia | `write.spelling` |
| Split Cells | Dividir Células | `write.splitCells` |
| Hyperlink | Hiperligação | `write.styleName.hyperlink` |
| Numbering… | Numeração… | `write.styles.format.numbering` |
| Text Box | Caixa de Texto | `write.textBox` |
| Wrap Text | Moldar Texto | `write.wrapText` |
| Cross-reference | Referência cruzada | `write.xref.button` |
| Footnote | Nota de rodapé | `write.xref.footnote` |
| Reset | Repor | `write.notes.sep.reset` |
| Format Background | Formatar Fundo | `show.bg.format` |
| Background Styles | Estilos de Fundo | `show.bg.styles` |
| Fonts | Tipos de Letra | `show.design.fonts` |
| Themes | Temas | `show.design.themes` |
| Header & Footer… | Cabeçalho e Rodapé… | `show.hf.titleDots` |
| Slide Master | Modelo de Diapositivos | `show.master.tab` |
| Slide Size | Tamanho do Diapositivo | `show.size.customTitle` |
| Set Up Slide Show | Configurar Apresentação | `show.setup.titleDots` |
| Guides | Guias | `show.view.guides` |
| Notes Page | Página de Notas | `show.view.notesPage` |
| Outline View | Vista de Estrutura | `show.view.outline` |
| Reading View | Vista de Leitura | `show.view.reading` |
| Slide Sorter | Ordenação de Diapositivos | `show.view.sorter` |
| Edit Points | Editar Pontos | `show.editPoints` |
| Fill Color | Cor de Preenchimento | `show.fx.fillColor` |
| Animation Painter | Pincel de Animação | `show.animPainter` |
| From Current Slide… | A Partir do Diapositivo Atual… | `show.recordFromCurrent` |
| From Beginning… | Desde o Início… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Cancelar | |
| Apply | Aplicar | |
| Close | Fechar | |
| Yes / No | Sim / Não | |
| Don't Save | Não guardar | |
| Browse… | Procurar… | |
| Reset | Repor | |
| Insert / Delete | Inserir / Eliminar | |
| Back / Next / Finish | Anterior / Seguinte / Concluir | wizards |
| Recent | Recentes | |
| Untitled | Sem Título | |
| Saved / Saving… / Unsaved changes | Guardado / A guardar… / Alterações não guardadas | |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Livro do Excel | `.xlsx` |
| Word Document | Documento do Word | `.docx` |
| PowerPoint Presentation | Apresentação do PowerPoint | `.pptx` |
| Excel / Word / PowerPoint Template | Modelo do Excel / Word / PowerPoint | |
| CSV (Comma delimited) | CSV (delimitado por vírgulas) | |
| Text Files | Ficheiros de Texto | |
| PDF | PDF | |
| Office Theme | Tema do Office | `.thmx` |
| All Files | Todos os Ficheiros | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation.

| English | Term | Key |
| --- | --- | --- |
| Appear | Aparecer | `show.fx.appear` |
| Disappear | Desaparecer | `show.fx.disappear` |
| Fade | Esbater | `show.fx.fade` |
| Fly In | Voar para Dentro | `show.fx.flyIn` |
| Fly Out | Voar para Fora | `show.fx.flyOut` |
| Grow/Shrink | Aumentar/Diminuir | `show.fx.growShrink` |
| Spin | Rodar | `show.fx.spin` |
| Wipe | Limpar | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Cobrir | `show.trans.cover` |
| Cut | Corte | `show.trans.cut` |
| Fade | Esbater | `show.trans.fade` |
| None | Nenhuma | `show.trans.none` |
| Push | Empurrar | `show.trans.push` |
| Split | Dividir | `show.trans.split` |
| Wipe | Limpar | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Transformação | `show.trans.morph` |
| Reveal | Revelar | `show.trans.reveal` |
| Shred | Destroçar | `show.trans.shred` |
| Fall Over | Queda | `show.trans.fallOver` |
| Drape | Cortina Drapejada | `show.trans.drape` |
| Curtains | Cortinas | `show.trans.curtains` |
| Wind | Vento | `show.trans.wind` |
| Prestige | Prestígio | `show.trans.prestige` |
| Fracture | Fratura | `show.trans.fracture` |
| Crush | Esmagar | `show.trans.crush` |
| Peel Off | Descascar | `show.trans.peelOff` |
| Page Curl | Enrolar Página | `show.trans.pageCurl` |
| Airplane | Avião | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Favo de Mel | `show.trans.honeycomb` |
| Glitter | Cintilar | `show.trans.glitter` |
| Vortex | Vórtice | `show.trans.vortex` |
| Ripple | Ondulação | `show.trans.ripple` |
| Switch | Interruptor | `show.trans.switch` |
| Flip | Virar | `show.trans.flip` |
| Gallery | Galeria | `show.trans.gallery` |
| Cube | Cubo | `show.trans.cube` |
| Doors | Portas | `show.trans.doors` |
| Box | Caixa | `show.trans.box` |
| Float In | Flutuar para Dentro | `show.fx.float` |
| Float Out | Flutuar para Fora | `show.fx.floatOut` |
| Split | Dividir | `show.fx.split` |
| Shape | Forma | `show.fx.shape` |
| Circle | Círculo | `show.fx.circle` |
| Box | Caixa | `show.fx.box` |
| Diamond | Losango | `show.fx.diamond` |
| Plus | Mais | `show.fx.plus` |
| Wheel | Roda | `show.fx.wheel` |
| Random Bars | Barras Aleatórias | `show.fx.randomBars` |
| Grow & Turn | Aumentar e Rodar | `show.fx.growTurn` |
| Shrink & Turn | Diminuir e Rodar | `show.fx.shrinkTurn` |
| Swivel | Pivô | `show.fx.swivel` |
| Bounce | Ressalto | `show.fx.bounce` |
| Pulse | Pulsar | `show.fx.pulse` |
| Color Pulse | Pulsar Cor | `show.fx.colorPulse` |
| Teeter | Cambalear | `show.fx.teeter` |
| Desaturate | Dessaturar | `show.fx.desaturate` |
| Darken | Escurecer | `show.fx.darken` |
| Lighten | Clarear | `show.fx.lighten` |
| Transparency | Transparência | `show.fx.transparency` |
| Object Color | Cor do Objeto | `show.fx.objectColor` |
| Line Color | Cor da Linha | `show.fx.lineColor` |
| Fill Color | Cor de Preenchimento | `show.fx.fillColor` |
| Brush Color | Cor do Pincel | `show.fx.brushColor` |
| Font Color | Cor do Tipo de Letra | `show.fx.fontColor` |
| Underline | Sublinhar | `show.fx.underline` |
| Bold Flash | Intermitência a Negrito | `show.fx.boldFlash` |
| Bold Reveal | Revelação a Negrito | `show.fx.boldReveal` |
| Wave | Onda | `show.fx.wave` |
| Lines | Linhas | `show.fx.pathLines` |
| Arcs | Arcos | `show.fx.pathArcs` |
| Turns | Curvas | `show.fx.pathTurns` |
| Shapes | Formas | `show.fx.pathShapes` |
| Loops | Laços | `show.fx.pathLoops` |
| Custom Path | Caminho Personalizado | `show.fx.pathCustom` |
| Play | Reproduzir | `show.fx.mediaPlay` |
| Pause | Pausa | `show.fx.mediaPause` |
| Stop | Parar | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Ribbon | Friso | |
| Worksheet / Sheet | Folha de cálculo / Folha | |
| Workbook | Livro | |
| Spill | Derrame | dynamic arrays |
| Named range / Name Manager | Nome definido / Gestor de Nomes | |
| Alt text | Texto alternativo | |
| Placeholder (slide) | Marcador de posição | |
| Layout (slide) | Esquema | |
| Transition | Transição | |
| Morph | Transformação | |
| Comment thread | Conversa de comentários | |
| AI | IA | not "AI" |
| Provider | Fornecedor | AI provider |
| Token | Token | |
| Connection | Ligação | WebDAV |
| Autosave | Gravação automática | |
| Sparkline / Sparklines | Gráfico Sparkline / Gráficos Sparkline | Calc (P9-LF) |
| Line / Column / Win/Loss (sparkline types) | Linha / Coluna / Ganhos/Perdas | Calc |
| Error Bars / Data Table | Barras de Erro / Tabela de Dados | Calc charts |
| High-Low Lines / Up/Down Bars | Linhas de Máximo/Mínimo / Barras Para Cima/Para Baixo | Calc charts |
| Go To Special… | Ir para Especial… | Calc |
| Picture Format / Alt Text | Formatar Imagem / Texto alternativo | Calc |
| Reasoning (AI setting, reasoning_effort) | Raciocínio | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | ignorado/a(s) | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | lido/a como | reader warnings |
| dangling relationship | relação inválida | reader warnings |
| Custom show (PowerPoint) | Apresentação Personalizada | `reader.pptx.customShow.*` |
| Pivot cache | cache de tabela dinâmica | `reader.xlsx.pivotCache.*` |
