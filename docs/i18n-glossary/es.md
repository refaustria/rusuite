# Glossary: Spanish (`es`)

Source: the Spanish (Spain/International) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L1. Reviewer: P9-LR1 (2026-10-17).

## Register
- Address: informal "tú / te / tu / tus", imperatives in the familiar form ("Escribe", "Comprueba", "Haz clic", "Elige"); never "usted / ustedes" or formal imperatives ("Escriba", "Haga clic"). "su / sus" is only used as a genuine third-person possessive (the document's, the server's); the user's own things are "tu / tus".
- Buttons and menu commands: infinitive ("Guardar", "Insertar tabla"), as Office does; messages to the user are in the informal imperative or a neutral statement.
- Ellipsis "…" for commands that open a dialog, as in English.
- Questions and exclamations open with "¿" / "¡"; quotes in running text are « » only where the English has “ ”, otherwise straight quotes are kept.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Mayús, Delete = Supr, Enter = Entrar.
- Plural categories: `one / many / other`; `many` (millions) puts "de" before the noun ("{count} de páginas" = "1 000 000 de páginas"); unit abbreviations ("hace {count} h") stay as in `other`.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Archivo | |
| Home | Inicio | |
| Insert | Insertar | |
| Draw | Dibujar | |
| Design | Diseño | |
| Layout (Write: Layout, Calc: Page Layout) | Disposición / Diseño de página | Write: Disposición; Calc: Diseño de página |
| References | Referencias | Write |
| Mailings | Correspondencia | Write |
| Review | Revisar | |
| View | Vista | |
| Formulas | Fórmulas | Calc |
| Data | Datos | Calc |
| Transitions | Transiciones | Show |
| Animations | Animaciones | Show |
| Slide Show | Presentación con diapositivas | Show |
| Help | Ayuda | |
| Picture / Table / Chart / Drawing Tools (contextual) | Herramientas de imagen / de tabla / de gráficos / de dibujo | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Portapapeles | |
| Font | Fuente | |
| Paragraph | Párrafo | |
| Styles | Estilos | |
| Editing | Edición | |
| Number | Número | Calc |
| Alignment | Alineación | Calc |
| Cells | Celdas | Calc |
| Slides | Diapositivas | Show |
| Drawing | Dibujo | Show |
| Zoom | Zoom | |
| Show (View › Show) | Mostrar | |
| Language | Idioma | the picker; label "Idioma / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nuevo | |
| Open… | Abrir… | |
| Save | Guardar | |
| Save As… | Guardar como… | |
| Print | Imprimir | |
| Export PDF… | Exportar a PDF… | |
| Close | Cerrar | |
| Options… | Opciones… | |
| Undo / Redo | Deshacer / Rehacer | |
| Cut / Copy / Paste | Cortar / Copiar / Pegar | |
| Paste Special… | Pegado especial… | |
| Format Painter | Copiar formato | |
| Find / Replace… / Go To… | Buscar / Reemplazar… / Ir a… | |
| Select All | Seleccionar todo | |
| Bold / Italic / Underline / Strikethrough | Negrita / Cursiva / Subrayado / Tachado | |
| Font Color / Highlight / Fill Color | Color de fuente / Resaltar / Color de relleno | |
| Insert Picture / Table / Chart / Shape / Text Box | Insertar imagen / tabla / gráfico / forma / cuadro de texto | |
| Bring to Front / Send to Back | Traer al frente / Enviar al fondo | |
| Group / Ungroup | Agrupar / Desagrupar | |
| Sort / Filter | Ordenar / Filtrar | Calc |
| Insert Function | Insertar función | Calc |
| New Slide | Nueva diapositiva | Show |
| From Beginning / From Current Slide | Desde el principio / Desde la diapositiva actual | Show |
| Track Changes / Comments | Control de cambios / Comentarios | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR1), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Copiar | `ai.pane.copy` |
| Save | Guardar | `ai.settings.save` |
| Insert | Insertar | `ai.write.insert` |
| Close | Cerrar | `backstage.close` |
| New | Nuevo | `backstage.new` |
| Open… | Abrir… | `backstage.open` |
| Options… | Opciones… | `backstage.options` |
| Print | Imprimir | `backstage.print` |
| Save As… | Guardar como… | `backstage.saveAs` |
| Cut | Cortar | `cmd.cut` |
| Delete | Eliminar | `cmd.delete` |
| Find | Buscar | `cmd.find` |
| Paste | Pegar | `cmd.paste` |
| Redo | Rehacer | `cmd.redo` |
| Replace… | Reemplazar… | `cmd.replaceDots` |
| Undo | Deshacer | `cmd.undo` |
| Size | Tamaño | `conn.browser.colSize` |
| Rename | Cambiar nombre | `conn.browser.rename` |
| Bold | Negrita | `fmt.bold` |
| Borders | Bordes | `fmt.borders` |
| Colors | Colores | `fmt.colors` |
| Italic | Cursiva | `fmt.italic` |
| Strikethrough | Tachado | `fmt.strike` |
| Underline | Subrayado | `fmt.underline` |
| Zoom | Zoom | `group.zoom` |
| Layout | Disposición | `print.layoutSection` |
| Margins | Márgenes | `print.margins` |
| Normal | Normal | `print.margins.normal` |
| Orientation | Orientación | `print.orientation` |
| Format | Formato | `sc.format` |
| Remove Arrows | Quitar flechas | `calc.audit.removeArrows` |
| Show Formulas | Mostrar fórmulas | `calc.audit.showFormulas` |
| Trace Dependents | Rastrear dependientes | `calc.audit.traceDependents` |
| Trace Precedents | Rastrear precedentes | `calc.audit.tracePrecedents` |
| Breaks | Saltos de página | `calc.breaks` |
| Fill | Relleno | `calc.cf.barFill` |
| Clear | Borrar | `calc.cf.clearFormat` |
| Shapes | Formas | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Formato condicional | `calc.cf.menu` |
| Gridlines | Líneas de cuadrícula | `calc.chart.ae.gridlines` |
| Chart | Gráfico | `calc.chart.chart` |
| Center | Centro | `calc.chart.pos.center` |
| Recommended Charts | Gráficos recomendados | `calc.chart.recommended` |
| Shape Fill | Relleno de forma | `calc.chart.shapeFill` |
| Shape Outline | Contorno de forma | `calc.chart.shapeOutline` |
| New Comment | Nuevo comentario | `calc.comments.new` |
| Comment | Comentario | `calc.comments.textLabel` |
| Consolidate | Consolidar | `calc.consolidate.button` |
| Delete Cells… | Eliminar celdas… | `calc.deleteCellsDots` |
| Remove Duplicates | Quitar duplicados | `calc.dup.button` |
| Columns | Columnas | `calc.dup.columns` |
| Select All | Seleccionar todo | `calc.dup.selectAll` |
| Data Validation | Validación de datos | `calc.dv.button` |
| Filter | Filtro | `calc.filter` |
| Font Color | Color de fuente | `calc.filter.byFontColor` |
| Flash Fill | Relleno rápido | `calc.flash.button` |
| Effects | Efectos | `calc.fmt.effects` |
| Justify | Justificar | `calc.fmt.h.justify` |
| Indent | Sangría | `calc.fmt.indent` |
| Preview | Vista previa | `calc.fmt.preview` |
| Subscript | Subíndice | `calc.fmt.subscript` |
| Superscript | Superíndice | `calc.fmt.superscript` |
| Symbol | Símbolo | `calc.fmt.symbol` |
| AutoSum | Autosuma | `calc.fn.autoSum` |
| Insert Function | Insertar función | `calc.fn.insert` |
| Format Painter | Copiar formato | `calc.formatPainter` |
| Freeze Panes | Inmovilizar paneles | `calc.freezePanes` |
| Goal Seek… | Buscar objetivo… | `calc.goal.dots` |
| What-If Analysis | Análisis de hipótesis | `calc.goal.whatIf` |
| Hide | Ocultar | `calc.hide` |
| Insert Cells… | Insertar celdas… | `calc.insertCellsDots` |
| Link | Vínculo | `calc.link.button` |
| Merge Cells | Combinar celdas | `calc.mergeCells` |
| Merge & Center | Combinar y centrar | `calc.mergeCenter` |
| Move or Copy… | Mover o copiar… | `calc.moveCopy.dots` |
| Define Name | Definir nombre | `calc.names.define` |
| Name Manager | Administrador de nombres | `calc.names.manager` |
| Group | Agrupar | `calc.outline.group` |
| Ungroup | Desagrupar | `calc.outline.ungroup` |
| Page Setup | Configurar página | `calc.pageSetup` |
| Pictures | Imágenes | `calc.picture.button` |
| PivotTable | Tabla dinámica | `calc.pivot.pivotTable` |
| Refresh All | Actualizar todo | `calc.pivot.refreshAll` |
| Styles | Estilos | `calc.pivot.stylesGallery` |
| Print Area | Área de impresión | `calc.printArea` |
| Print Titles | Imprimir títulos | `calc.printTitles` |
| Sort | Ordenar | `calc.protect.allow.sort` |
| Protect Workbook | Proteger libro | `calc.protect.bookDots` |
| Protect Sheet… | Proteger hoja… | `calc.protect.sheetDots` |
| Paste Special… | Pegado especial… | `calc.ps.dots` |
| Error Checking | Comprobación de errores | `calc.err.dialogTitle` |
| Previous | Anterior | `calc.err.previous` |
| Next | Siguiente | `calc.err.next` |
| Evaluate Formula | Evaluar fórmula | `calc.eval.title` |
| Watch Window | Ventana Inspección | `calc.watch.title` |
| Calculate Now | Calcular ahora | `calc.calc.now` |
| Sort & Filter | Ordenar y filtrar | `calc.sortFilter` |
| Subtotal | Subtotal | `calc.subtotal.button` |
| Properties | Propiedades | `calc.table.properties` |
| Table | Tabla | `calc.table.table` |
| Unhide | Mostrar | `calc.unhide` |
| Text to Columns | Texto en columnas | `calc.wizard.ttcButton` |
| Align Left | Alinear a la izquierda | `write.alignObj.left` |
| Align Right | Alinear a la derecha | `write.alignObj.right` |
| Align | Alinear | `write.alignObjects` |
| Bookmark | Marcador | `write.bookmark.button` |
| Insert Caption | Insertar título | `write.caption.button` |
| Equation | Ecuación | `write.caption.equation` |
| Position | Posición | `write.caption.position` |
| Crop | Recortar | `write.crop` |
| Spacing | Espaciado | `write.font.spacing` |
| Bring Forward | Traer adelante | `write.order.bringForward` |
| Bring to Front | Traer al frente | `write.order.bringToFront` |
| Send Backward | Enviar atrás | `write.order.sendBackward` |
| Send to Back | Enviar al fondo | `write.order.sendToBack` |
| Picture | Imagen | `write.picture` |
| Section | Sección | `write.reveal.section` |
| Rotate | Girar | `write.rotate` |
| Ruler | Regla | `write.ruler` |
| Selection Pane | Panel de selección | `write.selectionPane` |
| Spelling | Ortografía | `write.spelling` |
| Split Cells | Dividir celdas | `write.splitCells` |
| Hyperlink | Hipervínculo | `write.styleName.hyperlink` |
| Numbering… | Numeración… | `write.styles.format.numbering` |
| Text Box | Cuadro de texto | `write.textBox` |
| Wrap Text | Ajustar texto | `write.wrapText` |
| Cross-reference | Referencia cruzada | `write.xref.button` |
| Footnote | Nota al pie | `write.xref.footnote` |
| Reset | Restablecer | `write.notes.sep.reset` |
| Format Background | Formato del fondo | `show.bg.format` |
| Background Styles | Estilos de fondo | `show.bg.styles` |
| Fonts | Fuentes | `show.design.fonts` |
| Themes | Temas | `show.design.themes` |
| Header & Footer… | Encabezado y pie de página… | `show.hf.titleDots` |
| Slide Master | Patrón de diapositivas | `show.master.tab` |
| Slide Size | Tamaño de diapositiva | `show.size.customTitle` |
| Set Up Slide Show | Configurar presentación | `show.setup.titleDots` |
| Guides | Guías | `show.view.guides` |
| Notes Page | Página de notas | `show.view.notesPage` |
| Outline View | Vista Esquema | `show.view.outline` |
| Reading View | Vista de lectura | `show.view.reading` |
| Slide Sorter | Clasificador de diapositivas | `show.view.sorter` |
| Edit Points | Modificar puntos | `show.editPoints` |
| Fill Color | Color de relleno | `show.fx.fillColor` |
| Animation Painter | Copiar animación | `show.animPainter` |
| From Current Slide… | Desde la diapositiva actual… | `show.recordFromCurrent` |
| From Beginning… | Desde el principio… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | Aceptar | |
| Cancel | Cancelar | |
| Apply | Aplicar | |
| Close | Cerrar | |
| Yes / No | Sí / No | |
| Don't Save | No guardar | the unsaved-changes prompt |
| Browse… | Examinar… | |
| Reset | Restablecer | |
| Insert / Delete | Insertar / Eliminar | |
| Back / Next / Finish | Atrás / Siguiente / Finalizar | wizards |
| Recent | Reciente | backstage |
| Untitled | Sin título | default document name |
| Saved / Saving… / Unsaved changes | Guardado / Guardando… / Cambios sin guardar | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Libro de Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Documento de Word | `.docx` |
| PowerPoint Presentation | Presentación de PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Plantilla de Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (delimitado por comas) | Calc: label stays "CSV / TXT" |
| Text Files | Archivos de texto | |
| PDF | PDF | |
| Office Theme | Tema de Office | `.thmx` |
| All Files | Todos los archivos | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation.

| English | Term | Key |
| --- | --- | --- |
| Appear | Aparecer | `show.fx.appear` |
| Disappear | Desaparecer | `show.fx.disappear` |
| Fade | Desvanecer | `show.fx.fade` |
| Fly In | Desplazar hacia dentro | `show.fx.flyIn` |
| Fly Out | Desplazar hacia fuera | `show.fx.flyOut` |
| Grow/Shrink | Crecer o encoger | `show.fx.growShrink` |
| Spin | Girar | `show.fx.spin` |
| Wipe | Barrido | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Cubrir | `show.trans.cover` |
| Cut | Corte | `show.trans.cut` |
| Fade | Desvanecer | `show.trans.fade` |
| None | Ninguna | `show.trans.none` |
| Push | Empujar | `show.trans.push` |
| Split | Dividir | `show.trans.split` |
| Wipe | Barrido | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Transformación | `show.trans.morph` |
| Reveal | Revelar | `show.trans.reveal` |
| Shred | Triturar | `show.trans.shred` |
| Fall Over | Caer | `show.trans.fallOver` |
| Drape | Cortinaje | `show.trans.drape` |
| Curtains | Cortinas | `show.trans.curtains` |
| Wind | Viento | `show.trans.wind` |
| Prestige | Prestigio | `show.trans.prestige` |
| Fracture | Fractura | `show.trans.fracture` |
| Crush | Aplastar | `show.trans.crush` |
| Peel Off | Despegar | `show.trans.peelOff` |
| Page Curl | Pasar página | `show.trans.pageCurl` |
| Airplane | Avión | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Panal | `show.trans.honeycomb` |
| Glitter | Brillo | `show.trans.glitter` |
| Vortex | Vórtice | `show.trans.vortex` |
| Ripple | Ondulación | `show.trans.ripple` |
| Switch | Cambiar | `show.trans.switch` |
| Flip | Voltear | `show.trans.flip` |
| Gallery | Galería | `show.trans.gallery` |
| Cube | Cubo | `show.trans.cube` |
| Doors | Puertas | `show.trans.doors` |
| Box | Caja | `show.trans.box` |
| Float In | Flotar hacia dentro | `show.fx.float` |
| Float Out | Flotar hacia fuera | `show.fx.floatOut` |
| Split | Dividir | `show.fx.split` |
| Shape | Forma | `show.fx.shape` |
| Circle | Círculo | `show.fx.circle` |
| Box | Caja | `show.fx.box` |
| Diamond | Rombo | `show.fx.diamond` |
| Plus | Más | `show.fx.plus` |
| Wheel | Rueda | `show.fx.wheel` |
| Random Bars | Barras al azar | `show.fx.randomBars` |
| Grow & Turn | Crecer y girar | `show.fx.growTurn` |
| Shrink & Turn | Encoger y girar | `show.fx.shrinkTurn` |
| Swivel | Giro | `show.fx.swivel` |
| Bounce | Rebote | `show.fx.bounce` |
| Pulse | Pulso | `show.fx.pulse` |
| Color Pulse | Pulso de color | `show.fx.colorPulse` |
| Teeter | Balancear | `show.fx.teeter` |
| Desaturate | Desaturar | `show.fx.desaturate` |
| Darken | Oscurecer | `show.fx.darken` |
| Lighten | Aclarar | `show.fx.lighten` |
| Transparency | Transparencia | `show.fx.transparency` |
| Object Color | Color del objeto | `show.fx.objectColor` |
| Line Color | Color de línea | `show.fx.lineColor` |
| Fill Color | Color de relleno | `show.fx.fillColor` |
| Brush Color | Color de pincel | `show.fx.brushColor` |
| Font Color | Color de fuente | `show.fx.fontColor` |
| Underline | Subrayado | `show.fx.underline` |
| Bold Flash | Destello en negrita | `show.fx.boldFlash` |
| Bold Reveal | Revelar en negrita | `show.fx.boldReveal` |
| Wave | Onda | `show.fx.wave` |
| Lines | Líneas | `show.fx.pathLines` |
| Arcs | Arcos | `show.fx.pathArcs` |
| Turns | Giros | `show.fx.pathTurns` |
| Shapes | Formas | `show.fx.pathShapes` |
| Loops | Bucles | `show.fx.pathLoops` |
| Custom Path | Trayectoria personalizada | `show.fx.pathCustom` |
| Play | Reproducir | `show.fx.mediaPlay` |
| Pause | Pausa | `show.fx.mediaPause` |
| Stop | Detener | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable / PivotChart | Tabla dinámica / Gráfico dinámico | |
| Slicer | Segmentación de datos | |
| Flash Fill | Relleno rápido | |
| Conditional Formatting | Formato condicional | |
| Data Validation | Validación de datos | |
| Slide master | Patrón de diapositivas | |
| Speaker notes | Notas del orador | |
| Presenter view | Vista del moderador | |
| Bookmark | Marcador | Write |
| Cross-reference | Referencia cruzada | Write |
| Footnote / Endnote | Nota al pie / Nota final | Write |
| Header / Footer | Encabezado / Pie de página | |
| Style set | Conjunto de estilos | Write |
| Defined name / Name Manager | Nombre definido / Administrador de nombres | Calc |
| Goal Seek | Buscar objetivo | Calc |
| Freeze Panes | Inmovilizar paneles | Calc |
| Remove Duplicates | Quitar duplicados | Calc |
| Text to Columns | Texto en columnas | Calc |
| Placeholder (slide) | Marcador de posición | Show |
| Spill (dynamic array) | Desbordamiento | Calc |
| Sparkline / Sparklines | Minigráfico / Minigráficos | Calc (P9-LF) |
| Line / Column / Win/Loss (sparkline types) | Línea / Columna / Ganancia o pérdida | Calc |
| Error Bars / Data Table | Barras de error / Tabla de datos | Calc charts |
| High-Low Lines / Up/Down Bars | Líneas de máximos y mínimos / Barras ascendentes/descendentes | Calc charts |
| Go To Special… | Ir a Especial… | Calc |
| Picture Format / Alt Text | Formato de imagen / Texto alternativo | Calc |
| Reasoning (AI setting, reasoning_effort) | Razonamiento | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | descartado/a(s) | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | leído/a como | reader warnings |
| dangling relationship | relación huérfana | reader warnings |
| Custom show (PowerPoint) | Presentación personalizada | `reader.pptx.customShow.*` |
| Pivot cache | caché de tabla dinámica | `reader.xlsx.pivotCache.*` |
