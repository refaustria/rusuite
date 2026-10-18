# Glossary: French (`fr`)

Source: the French (France) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L1. Reviewer: P9-LR1 (2026-10-17).

## Register
- Address: informal "tu / te / ton / ta / tes", imperatives in the familiar form ("Saisis", "Vérifie", "Clique", "Choisis"); never "vous / votre / vos" or "-ez" imperatives (Office's "Cliquez" becomes "Clique").
- Buttons and menu commands: infinitive ("Enregistrer", "Insérer un tableau"), as Office does; messages to the user are in the informal imperative or a neutral statement.
- Ellipsis "…" for commands that open a dialog, as in English.
- Typography: a no-break space (U+00A0) before `: ; ? !` and inside « » is part of the catalog values; apostrophes are typographic (’).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Maj, Delete = Suppr, Enter = Entrée.
- Plural categories: `one / many / other`; `many` (millions) puts "de" before the noun ("{count} de pages", "{count} d’éléments" = "1 000 000 de pages"); unit abbreviations ("il y a {count} h") stay as in `other`.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fichier | |
| Home | Accueil | |
| Insert | Insertion | |
| Draw | Dessin | |
| Design | Création | PowerPoint/Word "Création" |
| Layout (Write: Layout, Calc: Page Layout) | Mise en page | Calc: "Mise en page" |
| References | Références | Write |
| Mailings | Publipostage | Write |
| Review | Révision | |
| View | Affichage | |
| Formulas | Formules | Calc |
| Data | Données | Calc |
| Transitions | Transitions | Show |
| Animations | Animations | Show |
| Slide Show | Diaporama | Show |
| Help | Aide | |
| Picture / Table / Chart / Drawing Tools (contextual) | Outils Image / de tableau / de graphique / de dessin | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Presse-papiers | |
| Font | Police | |
| Paragraph | Paragraphe | |
| Styles | Styles | |
| Editing | Édition | |
| Number | Nombre | Calc |
| Alignment | Alignement | Calc |
| Cells | Cellules | Calc |
| Slides | Diapositives | Show |
| Drawing | Dessin | Show |
| Zoom | Zoom | |
| Show (View › Show) | Afficher | |
| Language | Langue | the picker; label "Langue / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nouveau | |
| Open… | Ouvrir… | |
| Save | Enregistrer | |
| Save As… | Enregistrer sous… | |
| Print | Imprimer | |
| Export PDF… | Exporter au format PDF… | |
| Close | Fermer | |
| Options… | Options… | |
| Undo / Redo | Annuler / Rétablir | |
| Cut / Copy / Paste | Couper / Copier / Coller | |
| Paste Special… | Collage spécial… | |
| Format Painter | Reproduire la mise en forme | |
| Find / Replace… / Go To… | Rechercher / Remplacer… / Atteindre… | |
| Select All | Sélectionner tout | |
| Bold / Italic / Underline / Strikethrough | Gras / Italique / Souligné / Barré | |
| Font Color / Highlight / Fill Color | Couleur de police / Surlignage / Couleur de remplissage | |
| Insert Picture / Table / Chart / Shape / Text Box | Insérer une image / un tableau / un graphique / une forme / une zone de texte | |
| Bring to Front / Send to Back | Premier plan / Arrière-plan | |
| Group / Ungroup | Grouper / Dissocier | |
| Sort / Filter | Trier / Filtrer | Calc |
| Insert Function | Insérer une fonction | Calc |
| New Slide | Nouvelle diapositive | Show |
| From Beginning / From Current Slide | Depuis le début / À partir de la diapositive actuelle | Show |
| Track Changes / Comments | Suivi des modifications / Commentaires | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR1), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Copier | `ai.pane.copy` |
| Save | Enregistrer | `ai.settings.save` |
| Insert | Insérer | `ai.write.insert` |
| Close | Fermer | `backstage.close` |
| New | Nouveau | `backstage.new` |
| Open… | Ouvrir… | `backstage.open` |
| Options… | Options… | `backstage.options` |
| Print | Imprimer | `backstage.print` |
| Save As… | Enregistrer sous… | `backstage.saveAs` |
| Cut | Couper | `cmd.cut` |
| Delete | Supprimer | `cmd.delete` |
| Find | Rechercher | `cmd.find` |
| Paste | Coller | `cmd.paste` |
| Redo | Rétablir | `cmd.redo` |
| Replace… | Remplacer… | `cmd.replaceDots` |
| Undo | Annuler | `cmd.undo` |
| Size | Taille | `conn.browser.colSize` |
| Rename | Renommer | `conn.browser.rename` |
| Bold | Gras | `fmt.bold` |
| Borders | Bordures | `fmt.borders` |
| Colors | Couleurs | `fmt.colors` |
| Italic | Italique | `fmt.italic` |
| Strikethrough | Barré | `fmt.strike` |
| Underline | Souligné | `fmt.underline` |
| Zoom | Zoom | `group.zoom` |
| Layout | Mise en page | `print.layoutSection` |
| Margins | Marges | `print.margins` |
| Normal | Normales | `print.margins.normal` |
| Orientation | Orientation | `print.orientation` |
| Format | Format | `sc.format` |
| Remove Arrows | Supprimer les flèches | `calc.audit.removeArrows` |
| Show Formulas | Afficher les formules | `calc.audit.showFormulas` |
| Trace Dependents | Repérer les dépendants | `calc.audit.traceDependents` |
| Trace Precedents | Repérer les antécédents | `calc.audit.tracePrecedents` |
| Breaks | Sauts de page | `calc.breaks` |
| Fill | Remplissage | `calc.cf.barFill` |
| Clear | Effacer | `calc.cf.clearFormat` |
| Shapes | Formes | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Mise en forme conditionnelle | `calc.cf.menu` |
| Gridlines | Quadrillage | `calc.chart.ae.gridlines` |
| Chart | Graphique | `calc.chart.chart` |
| Center | Centre | `calc.chart.pos.center` |
| Recommended Charts | Graphiques recommandés | `calc.chart.recommended` |
| Shape Fill | Remplissage de forme | `calc.chart.shapeFill` |
| Shape Outline | Contour de forme | `calc.chart.shapeOutline` |
| New Comment | Nouveau commentaire | `calc.comments.new` |
| Comment | Commentaire | `calc.comments.textLabel` |
| Consolidate | Consolider | `calc.consolidate.button` |
| Delete Cells… | Supprimer les cellules… | `calc.deleteCellsDots` |
| Remove Duplicates | Supprimer les doublons | `calc.dup.button` |
| Columns | Colonnes | `calc.dup.columns` |
| Select All | Sélectionner tout | `calc.dup.selectAll` |
| Data Validation | Validation des données | `calc.dv.button` |
| Filter | Filtrer | `calc.filter` |
| Font Color | Couleur de police | `calc.filter.byFontColor` |
| Flash Fill | Remplissage instantané | `calc.flash.button` |
| Effects | Effets | `calc.fmt.effects` |
| Justify | Justifié | `calc.fmt.h.justify` |
| Indent | Retrait | `calc.fmt.indent` |
| Preview | Aperçu | `calc.fmt.preview` |
| Subscript | Indice | `calc.fmt.subscript` |
| Superscript | Exposant | `calc.fmt.superscript` |
| Symbol | Symbole | `calc.fmt.symbol` |
| AutoSum | Somme automatique | `calc.fn.autoSum` |
| Insert Function | Insérer une fonction | `calc.fn.insert` |
| Format Painter | Reproduire la mise en forme | `calc.formatPainter` |
| Freeze Panes | Figer les volets | `calc.freezePanes` |
| Goal Seek… | Valeur cible… | `calc.goal.dots` |
| What-If Analysis | Analyse de scénarios | `calc.goal.whatIf` |
| Hide | Masquer | `calc.hide` |
| Insert Cells… | Insérer des cellules… | `calc.insertCellsDots` |
| Link | Lien | `calc.link.button` |
| Merge Cells | Fusionner les cellules | `calc.mergeCells` |
| Merge & Center | Fusionner et centrer | `calc.mergeCenter` |
| Move or Copy… | Déplacer ou copier… | `calc.moveCopy.dots` |
| Define Name | Définir un nom | `calc.names.define` |
| Name Manager | Gestionnaire de noms | `calc.names.manager` |
| Group | Grouper | `calc.outline.group` |
| Ungroup | Dissocier | `calc.outline.ungroup` |
| Page Setup | Mise en page | `calc.pageSetup` |
| Pictures | Images | `calc.picture.button` |
| PivotTable | Tableau croisé dynamique | `calc.pivot.pivotTable` |
| Refresh All | Actualiser tout | `calc.pivot.refreshAll` |
| Styles | Styles | `calc.pivot.stylesGallery` |
| Print Area | Zone d’impression | `calc.printArea` |
| Print Titles | Titres à imprimer | `calc.printTitles` |
| Sort | Trier | `calc.protect.allow.sort` |
| Protect Workbook | Protéger le classeur | `calc.protect.bookDots` |
| Protect Sheet… | Protéger la feuille… | `calc.protect.sheetDots` |
| Paste Special… | Collage spécial… | `calc.ps.dots` |
| Error Checking | Vérification des erreurs | `calc.err.dialogTitle` |
| Previous | Précédent | `calc.err.previous` |
| Next | Suivant | `calc.err.next` |
| Evaluate Formula | Évaluation de formule | `calc.eval.title` |
| Watch Window | Fenêtre Espion | `calc.watch.title` |
| Calculate Now | Calculer maintenant | `calc.calc.now` |
| Sort & Filter | Trier et filtrer | `calc.sortFilter` |
| Subtotal | Sous-total | `calc.subtotal.button` |
| Properties | Propriétés | `calc.table.properties` |
| Table | Tableau | `calc.table.table` |
| Unhide | Afficher | `calc.unhide` |
| Text to Columns | Convertir | `calc.wizard.ttcButton` |
| Align Left | Aligner à gauche | `write.alignObj.left` |
| Align Right | Aligner à droite | `write.alignObj.right` |
| Align | Aligner | `write.alignObjects` |
| Bookmark | Signet | `write.bookmark.button` |
| Insert Caption | Insérer une légende | `write.caption.button` |
| Equation | Équation | `write.caption.equation` |
| Position | Position | `write.caption.position` |
| Crop | Rogner | `write.crop` |
| Spacing | Espacement | `write.font.spacing` |
| Bring Forward | Avancer | `write.order.bringForward` |
| Bring to Front | Mettre au premier plan | `write.order.bringToFront` |
| Send Backward | Reculer | `write.order.sendBackward` |
| Send to Back | Mettre à l’arrière-plan | `write.order.sendToBack` |
| Picture | Image | `write.picture` |
| Section | Section | `write.reveal.section` |
| Rotate | Rotation | `write.rotate` |
| Ruler | Règle | `write.ruler` |
| Selection Pane | Volet Sélection | `write.selectionPane` |
| Spelling | Orthographe | `write.spelling` |
| Split Cells | Fractionner les cellules | `write.splitCells` |
| Hyperlink | Lien hypertexte | `write.styleName.hyperlink` |
| Numbering… | Numérotation… | `write.styles.format.numbering` |
| Text Box | Zone de texte | `write.textBox` |
| Wrap Text | Habillage du texte | `write.wrapText` |
| Cross-reference | Renvoi | `write.xref.button` |
| Footnote | Note de bas de page | `write.xref.footnote` |
| Reset | Réinitialiser | `write.notes.sep.reset` |
| Format Background | Format de l’arrière-plan | `show.bg.format` |
| Background Styles | Styles d’arrière-plan | `show.bg.styles` |
| Fonts | Polices | `show.design.fonts` |
| Themes | Thèmes | `show.design.themes` |
| Header & Footer… | En-tête et pied de page… | `show.hf.titleDots` |
| Slide Master | Masque des diapositives | `show.master.tab` |
| Slide Size | Taille des diapositives | `show.size.customTitle` |
| Set Up Slide Show | Configurer le diaporama | `show.setup.titleDots` |
| Guides | Repères | `show.view.guides` |
| Notes Page | Page de notes | `show.view.notesPage` |
| Outline View | Mode Plan | `show.view.outline` |
| Reading View | Mode Lecture | `show.view.reading` |
| Slide Sorter | Trieuse de diapositives | `show.view.sorter` |
| Edit Points | Modifier les points | `show.editPoints` |
| Fill Color | Couleur de remplissage | `show.fx.fillColor` |
| Animation Painter | Reproduire l’animation | `show.animPainter` |
| From Current Slide… | À partir de la diapositive actuelle… | `show.recordFromCurrent` |
| From Beginning… | Depuis le début… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Annuler | |
| Apply | Appliquer | |
| Close | Fermer | |
| Yes / No | Oui / Non | |
| Don't Save | Ne pas enregistrer | the unsaved-changes prompt |
| Browse… | Parcourir… | |
| Reset | Réinitialiser / Rétablir | |
| Insert / Delete | Insérer / Supprimer | |
| Back / Next / Finish | Précédent / Suivant / Terminer | wizards |
| Recent | Récent | backstage |
| Untitled | Sans titre | default document name |
| Saved / Saving… / Unsaved changes | Enregistré / Enregistrement… / Modifications non enregistrées | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Classeur Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Document Word | `.docx` |
| PowerPoint Presentation | Présentation PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Modèle Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (séparateur : point-virgule) | Calc: label stays "CSV / TXT" |
| Text Files | Fichiers texte | |
| PDF | PDF | |
| Office Theme | Thème Office | `.thmx` |
| All Files | Tous les fichiers | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation.

| English | Term | Key |
| --- | --- | --- |
| Appear | Apparaître | `show.fx.appear` |
| Disappear | Disparaître | `show.fx.disappear` |
| Fade | Fondu | `show.fx.fade` |
| Fly In | Entrée brusque | `show.fx.flyIn` |
| Fly Out | Sortie brusque | `show.fx.flyOut` |
| Grow/Shrink | Agrandir/Réduire | `show.fx.growShrink` |
| Spin | Rotation | `show.fx.spin` |
| Wipe | Balayage | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Recouvrir | `show.trans.cover` |
| Cut | Coupure | `show.trans.cut` |
| Fade | Fondu | `show.trans.fade` |
| None | Aucune | `show.trans.none` |
| Push | Poussée | `show.trans.push` |
| Split | Fractionner | `show.trans.split` |
| Wipe | Balayage | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Morphose | `show.trans.morph` |
| Reveal | Révélation | `show.trans.reveal` |
| Shred | Déchiquetage | `show.trans.shred` |
| Fall Over | Chute | `show.trans.fallOver` |
| Drape | Drapé | `show.trans.drape` |
| Curtains | Rideaux | `show.trans.curtains` |
| Wind | Vent | `show.trans.wind` |
| Prestige | Prestige | `show.trans.prestige` |
| Fracture | Fracture | `show.trans.fracture` |
| Crush | Écrasement | `show.trans.crush` |
| Peel Off | Décollement | `show.trans.peelOff` |
| Page Curl | Page cornée | `show.trans.pageCurl` |
| Airplane | Avion en papier | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Nid d’abeille | `show.trans.honeycomb` |
| Glitter | Paillettes | `show.trans.glitter` |
| Vortex | Vortex | `show.trans.vortex` |
| Ripple | Ondulation | `show.trans.ripple` |
| Switch | Basculement | `show.trans.switch` |
| Flip | Retournement | `show.trans.flip` |
| Gallery | Galerie | `show.trans.gallery` |
| Cube | Cube | `show.trans.cube` |
| Doors | Portes | `show.trans.doors` |
| Box | Boîte | `show.trans.box` |
| Float In | Flottant entrant | `show.fx.float` |
| Float Out | Flottant sortant | `show.fx.floatOut` |
| Split | Fractionner | `show.fx.split` |
| Shape | Forme | `show.fx.shape` |
| Circle | Cercle | `show.fx.circle` |
| Box | Boîte | `show.fx.box` |
| Diamond | Losange | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Roue | `show.fx.wheel` |
| Random Bars | Barres aléatoires | `show.fx.randomBars` |
| Grow & Turn | Agrandir et pivoter | `show.fx.growTurn` |
| Shrink & Turn | Réduire et pivoter | `show.fx.shrinkTurn` |
| Swivel | Pivot | `show.fx.swivel` |
| Bounce | Rebond | `show.fx.bounce` |
| Pulse | Impulsion | `show.fx.pulse` |
| Color Pulse | Impulsion de couleur | `show.fx.colorPulse` |
| Teeter | Bascule | `show.fx.teeter` |
| Desaturate | Désaturer | `show.fx.desaturate` |
| Darken | Assombrir | `show.fx.darken` |
| Lighten | Éclaircir | `show.fx.lighten` |
| Transparency | Transparence | `show.fx.transparency` |
| Object Color | Couleur de l’objet | `show.fx.objectColor` |
| Line Color | Couleur du trait | `show.fx.lineColor` |
| Fill Color | Couleur de remplissage | `show.fx.fillColor` |
| Brush Color | Couleur du pinceau | `show.fx.brushColor` |
| Font Color | Couleur de police | `show.fx.fontColor` |
| Underline | Souligné | `show.fx.underline` |
| Bold Flash | Éclair gras | `show.fx.boldFlash` |
| Bold Reveal | Révélation en gras | `show.fx.boldReveal` |
| Wave | Vague | `show.fx.wave` |
| Lines | Lignes | `show.fx.pathLines` |
| Arcs | Arcs | `show.fx.pathArcs` |
| Turns | Virages | `show.fx.pathTurns` |
| Shapes | Formes | `show.fx.pathShapes` |
| Loops | Boucles | `show.fx.pathLoops` |
| Custom Path | Trajectoire personnalisée | `show.fx.pathCustom` |
| Play | Lecture | `show.fx.mediaPlay` |
| Pause | Pause | `show.fx.mediaPause` |
| Stop | Arrêt | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable / PivotChart | Tableau croisé dynamique / Graphique croisé dynamique | |
| Slicer | Segment | |
| Flash Fill | Remplissage instantané | |
| Conditional Formatting | Mise en forme conditionnelle | |
| Data Validation | Validation des données | |
| Slide master | Masque des diapositives | |
| Speaker notes | Notes du présentateur | |
| Presenter view | Mode Présentateur | |
| Bookmark | Signet | Write |
| Cross-reference | Renvoi | Write |
| Footnote / Endnote | Note de bas de page / Note de fin | Write |
| Header / Footer | En-tête / Pied de page | |
| Style set | Jeu de styles | Write |
| Defined name / Name Manager | Nom défini / Gestionnaire de noms | Calc |
| Goal Seek | Valeur cible | Calc |
| Freeze Panes | Figer les volets | Calc |
| Remove Duplicates | Supprimer les doublons | Calc |
| Text to Columns | Convertir | Calc (Office button label) |
| Placeholder (slide) | Espace réservé | Show |
| Spill (dynamic array) | Déversement | Calc |
| Sparkline / Sparklines (Insert group) | Sparkline / Graphiques sparkline | Calc (P9-LF) |
| Line / Column / Win/Loss (sparkline types) | Courbe / Histogramme / Positif/Négatif | Calc |
| Error Bars / Data Table | Barres d’erreur / Table de données | Calc charts |
| High-Low Lines / Up/Down Bars | Lignes haut/bas / Barres haut/bas | Calc charts |
| Go To Special… / Special… | Sélectionner les cellules… / Cellules… | Calc |
| Picture Format / Alt Text | Format de l’image / Texte de remplacement | Calc |
