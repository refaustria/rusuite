//! Review › Protect Sheet / Protect Workbook: the protection commands and
//! the check every command passes on a protected sheet or a workbook
//! with a locked structure ([`CalcDocument::check_protection`]).

use app_common::Applied;
use base64::Engine as _;
use model_sheet::{CellRange, Error as M, Password, SheetId, SheetProtection, WorkbookProtection};

use crate::command::{CalcCommand, PasteMode};
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};
use crate::patch::CalcPatch;

/// The salt for a password: the UI's (base64), else 16 bytes derived from
/// the password and `context` (core crates have no random source).
fn salt_of(salt: Option<&str>, password: &str, context: &str) -> Vec<u8> {
    let b64 = base64::engine::general_purpose::STANDARD;
    salt.and_then(|s| b64.decode(s).ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let h = model_sheet::HashedPassword::sha512(
                &format!("{context}\u{0}{password}"),
                b"rusuite-salt",
                1,
            );
            let mut bytes = b64.decode(h.hash_value).unwrap_or_default();
            bytes.truncate(16);
            bytes
        })
}

fn protected() -> CalcError {
    CalcError::Model(M::SheetProtected)
}

impl CalcDocument {
    fn sheet_list_patch(&self) -> CalcPatch {
        CalcPatch {
            sheets: Some(self.sheet_infos()),
            ..Default::default()
        }
    }

    /// [`CalcCommand::ProtectSheet`].
    pub(crate) fn protect_sheet(
        &mut self,
        sheet: u32,
        options: &SheetProtection,
        password: Option<&str>,
        salt: Option<&str>,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let password = password.unwrap_or_default();
        let name = self.workbook().engine().sheet_name(s).unwrap_or_default();
        let p = SheetProtection {
            sheet: true,
            password: Password::new(password, &salt_of(salt, password, name)),
            ..options.clone()
        };
        self.restore_sheet_protection(sheet, Some(p))
    }

    /// [`CalcCommand::UnprotectSheet`].
    pub(crate) fn unprotect_sheet(
        &mut self,
        sheet: u32,
        password: Option<&str>,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        if let Some(p) = self.workbook().active_protection(s) {
            if !p.password.verify(password.unwrap_or_default()) {
                return Err(M::WrongPassword.into());
            }
        }
        self.restore_sheet_protection(sheet, None)
    }

    /// [`CalcCommand::RestoreSheetProtection`].
    pub(crate) fn restore_sheet_protection(
        &mut self,
        sheet: u32,
        protection: Option<SheetProtection>,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let prev = self.workbook().sheet_protection(s).cloned();
        self.workbook_mut().set_sheet_protection(s, protection)?;
        Ok(Applied {
            patch: self.sheet_list_patch(),
            inverse: Some(CalcCommand::RestoreSheetProtection {
                sheet,
                protection: prev,
            }),
        })
    }

    /// [`CalcCommand::ProtectWorkbook`].
    pub(crate) fn protect_workbook(
        &mut self,
        structure: bool,
        windows: bool,
        password: Option<&str>,
        salt: Option<&str>,
    ) -> Result<CalcApplied> {
        let password = password.unwrap_or_default();
        let p = WorkbookProtection {
            lock_structure: structure,
            lock_windows: windows,
            password: Password::new(password, &salt_of(salt, password, "workbook")),
        };
        self.restore_workbook_protection(Some(p))
    }

    /// [`CalcCommand::UnprotectWorkbook`].
    pub(crate) fn unprotect_workbook(&mut self, password: Option<&str>) -> Result<CalcApplied> {
        if let Some(p) = self.workbook().workbook_protection() {
            if !p.password.verify(password.unwrap_or_default()) {
                return Err(M::WrongPassword.into());
            }
        }
        self.restore_workbook_protection(None)
    }

    /// [`CalcCommand::RestoreWorkbookProtection`].
    pub(crate) fn restore_workbook_protection(
        &mut self,
        protection: Option<WorkbookProtection>,
    ) -> Result<CalcApplied> {
        let prev = self.workbook().workbook_protection().cloned();
        self.workbook_mut().set_workbook_protection(protection);
        let now = self
            .workbook()
            .workbook_protection()
            .filter(|p| p.is_active())
            .cloned()
            .unwrap_or_default();
        Ok(Applied {
            patch: CalcPatch {
                workbook_protection: Some(Box::new(now)),
                ..Default::default()
            },
            inverse: Some(CalcCommand::RestoreWorkbookProtection { protection: prev }),
        })
    }

    /// The protection in force on `sheet` (unknown sheets: none, the
    /// command reports them itself).
    fn protection_of(&self, sheet: u32) -> Option<&SheetProtection> {
        let s = self.sheet(sheet).ok()?;
        self.workbook().active_protection(s)
    }

    /// Fails when `sheet` is protected and `forbidden(protection)`.
    fn deny_if(&self, sheet: u32, forbidden: impl Fn(&SheetProtection) -> bool) -> Result<()> {
        match self.protection_of(sheet) {
            Some(p) if forbidden(p) => Err(protected()),
            _ => Ok(()),
        }
    }

    /// Fails when `sheet` is protected and the range holds a locked cell.
    fn deny_locked(&self, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> Result<()> {
        if self.protection_of(sheet).is_none() {
            return Ok(());
        }
        let s = SheetId(sheet);
        if self
            .workbook()
            .range_has_locked(CellRange::new(s, r0, c0, r1.max(r0), c1.max(c0)))
        {
            return Err(protected());
        }
        Ok(())
    }

    fn deny_structure(&self) -> Result<()> {
        if self.workbook().structure_locked() {
            return Err(M::WorkbookProtected.into());
        }
        Ok(())
    }

    fn table_sheet(&self, id: u32) -> Option<u32> {
        self.workbook().table(id).map(|(s, _)| s.0)
    }

    fn pivot_sheet(&self, id: u32) -> Option<u32> {
        self.workbook().pivot(id).map(|(s, _)| s.0)
    }

    /// Refuses `cmd` like Excel when it changes a protected sheet in a way
    /// its protection does not allow (`sheet_protected`) or the sheet list
    /// of a workbook whose structure is locked (`workbook_protected`).
    /// Internal (undo) commands are not checked: they only undo steps
    /// made while the protection allowed them.
    pub(crate) fn check_protection(&self, cmd: &CalcCommand) -> Result<()> {
        use CalcCommand as C;
        let wb = self.workbook();
        let any_sheet = wb
            .sheets()
            .iter()
            .any(|(id, _)| wb.active_protection(*id).is_some());
        if !any_sheet && !wb.structure_locked() {
            return Ok(());
        }
        let always = |_: &SheetProtection| true;
        match cmd {
            C::Compound { commands } => commands.iter().try_for_each(|c| self.check_protection(c)),
            // Structure.
            C::AddSheet { .. }
            | C::DeleteSheet { .. }
            | C::RenameSheet { .. }
            | C::DuplicateSheet { .. }
            | C::MoveSheet { .. }
            | C::SetSheetTabColor { .. }
            | C::SetSheetHidden { .. }
            | C::ShowPivotDetails { .. } => {
                self.deny_structure()?;
                if let C::ShowPivotDetails { id, .. } = cmd {
                    if let Some(s) = self.pivot_sheet(*id) {
                        self.deny_if(s, |p| p.pivot_tables)?;
                    }
                }
                Ok(())
            }
            // Cell contents.
            &C::SetInput {
                sheet, row, col, ..
            } => self.deny_locked(sheet, row, col, row, col),
            &C::ClearRange {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => self.deny_locked(sheet, r0, c0, r1, c1),
            &C::TextToColumns { sheet, .. } => self.deny_if(sheet, always),
            &C::ApplyNames {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ..
            } => self.deny_locked(sheet, r0, c0, r1, c1),
            &C::PasteNameList { sheet, row, col } => self.deny_locked(
                sheet,
                row,
                col,
                row.saturating_add(255),
                col.saturating_add(1),
            ),
            &C::RemoveDuplicates {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ..
            } => self.deny_locked(sheet, r0, c0, r1, c1),
            C::FillRange { sheet, dst, .. } => {
                self.deny_locked(*sheet, dst.r0, dst.c0, dst.r1, dst.c1)
            }
            C::PasteRange {
                sheet,
                r0,
                c0,
                src,
                cut,
                mode,
                repeat_rows,
                repeat_cols,
                special,
                ..
            } => {
                let transpose = special.is_some_and(|s| s.transpose);
                let (mut h, mut w) = (src.r1 - src.r0 + 1, src.c1 - src.c0 + 1);
                if transpose {
                    std::mem::swap(&mut h, &mut w);
                }
                let h = h.saturating_mul((*repeat_rows).max(1));
                let w = w.saturating_mul((*repeat_cols).max(1));
                let (r1, c1) = (r0.saturating_add(h - 1), c0.saturating_add(w - 1));
                if *mode == PasteMode::FormatsOnly {
                    self.deny_if(*sheet, |p| p.format_cells)?;
                } else {
                    self.deny_locked(*sheet, *r0, *c0, r1, c1)?;
                }
                if *cut {
                    self.deny_locked(src.sheet, src.r0, src.c0, src.r1, src.c1)?;
                }
                Ok(())
            }
            // Formats.
            C::ApplyStyle { sheet, .. } | C::SetBorders { sheet, .. } => {
                self.deny_if(*sheet, |p| p.format_cells)
            }
            &C::MergeCells { sheet, .. } | &C::UnmergeCells { sheet, .. } => {
                self.deny_if(sheet, always)
            }
            &C::SetColWidth { sheet, .. } | &C::SetColHidden { sheet, .. } => {
                self.deny_if(sheet, |p| p.format_columns)
            }
            &C::SetRowHeight { sheet, .. } | &C::SetRowHidden { sheet, .. } => {
                self.deny_if(sheet, |p| p.format_rows)
            }
            // Rows and columns.
            &C::InsertRows { sheet, .. } => self.deny_if(sheet, |p| p.insert_rows),
            &C::InsertCols { sheet, .. } => self.deny_if(sheet, |p| p.insert_columns),
            &C::DeleteRows { sheet, at, count } => {
                self.deny_if(sheet, |p| p.delete_rows)?;
                let last = at.saturating_add(count.max(1) - 1);
                self.deny_locked(sheet, at, 0, last, engine_formula::ast::MAX_COL)
            }
            &C::DeleteCols { sheet, at, count } => {
                self.deny_if(sheet, |p| p.delete_columns)?;
                let last = at.saturating_add(count.max(1) - 1);
                self.deny_locked(sheet, 0, at, engine_formula::ast::MAX_ROW, last)
            }
            &C::InsertCells { sheet, .. } | &C::DeleteCells { sheet, .. } => {
                self.deny_if(sheet, always)
            }
            // Sort and filter.
            &C::SortRange {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ..
            } => {
                self.deny_if(sheet, |p| p.sort)?;
                self.deny_locked(sheet, r0, c0, r1, c1)
            }
            &C::SortSheetByColumn { sheet, .. } => self.deny_if(sheet, |p| p.sort),
            &C::SetAutoFilter { sheet, .. } => self.deny_if(sheet, always),
            &C::SetFilterColumn { sheet, .. }
            | &C::ClearFilters { sheet }
            | &C::ReapplyFilter { sheet } => self.deny_if(sheet, |p| p.auto_filter),
            // Rules, objects, links, outline, page breaks.
            C::AddCfRule { sheet, .. }
            | C::UpdateCfRule { sheet, .. }
            | C::RemoveCfRule { sheet, .. }
            | C::ReorderCfRule { sheet, .. }
            | C::ClearCf { sheet, .. }
            | C::SetValidation { sheet, .. }
            | C::RemoveValidation { sheet, .. }
            | C::GroupOutline { sheet, .. }
            | C::SetOutlineCollapsed { sheet, .. }
            | C::ShowOutlineLevel { sheet, .. }
            | C::ClearOutline { sheet, .. }
            | C::SetOutlineProps { sheet, .. }
            | C::Subtotal { sheet, .. }
            | C::AutoOutline { sheet, .. }
            | C::Consolidate { sheet, .. }
            | C::FlashFill { sheet, .. }
            | C::RemoveSubtotals { sheet, .. }
            | C::SetPageBreaks { sheet, .. }
            | C::CreateTable { sheet, .. }
            | C::CreateNamesFromSelection { sheet, .. } => self.deny_if(*sheet, always),
            C::AddChart { sheet, .. }
            | C::InsertPivotChart { sheet, .. }
            | C::UpdateChart { sheet, .. }
            | C::SetChartAnchor { sheet, .. }
            | C::SetChartSeries { sheet, .. }
            | C::RemoveChart { sheet, .. }
            | C::AddPicture { sheet, .. }
            | C::SetPictureAnchor { sheet, .. }
            | C::RemovePicture { sheet, .. }
            | C::SetNote { sheet, .. }
            | C::DeleteNote { sheet, .. }
            | C::ShowHideNote { sheet, .. }
            | C::ConvertNotesToComments { sheet, .. }
            | C::AddComment { sheet, .. }
            | C::ReplyComment { sheet, .. }
            | C::EditComment { sheet, .. }
            | C::DeleteReply { sheet, .. }
            | C::DeleteThread { sheet, .. }
            | C::ResolveThread { sheet, .. } => self.deny_if(*sheet, |p| p.objects),
            C::SetHyperlink { sheet, r0, c0, .. } => {
                self.deny_if(*sheet, |p| p.insert_hyperlinks)?;
                self.deny_locked(*sheet, *r0, *c0, *r0, *c0)
            }
            C::RemoveHyperlink { sheet, .. } => self.deny_if(*sheet, |p| p.insert_hyperlinks),
            // Tables (by id).
            C::SetTableFilter { id, .. } => match self.table_sheet(*id) {
                Some(s) => self.deny_if(s, |p| p.auto_filter),
                None => Ok(()),
            },
            C::RenameTable { id, .. }
            | C::SetTableStyle { id, .. }
            | C::SetTableOptions { id, .. }
            | C::SetTotalsFunction { id, .. }
            | C::ResizeTable { id, .. }
            | C::ConvertToRange { id, .. }
            | C::InsertTableRows { id, .. }
            | C::DeleteTableRows { id, .. }
            | C::InsertTableCols { id, .. }
            | C::DeleteTableCols { id, .. } => match self.table_sheet(*id) {
                Some(s) => self.deny_if(s, always),
                None => Ok(()),
            },
            // Pivot tables (by id).
            C::CreatePivot { target, .. } => match target {
                crate::pivots::PivotTarget::NewSheet => self.deny_structure(),
                crate::pivots::PivotTarget::Cell { sheet, .. } => self.deny_if(*sheet, always),
            },
            C::MovePivot { id, target } => {
                if let Some(s) = self.pivot_sheet(*id) {
                    self.deny_if(s, always)?;
                }
                match target {
                    crate::pivots::PivotTarget::NewSheet => self.deny_structure(),
                    crate::pivots::PivotTarget::Cell { sheet, .. } => self.deny_if(*sheet, always),
                }
            }
            C::DeletePivot { id } | C::ChangePivotSource { id, .. } => {
                match self.pivot_sheet(*id) {
                    Some(s) => self.deny_if(s, always),
                    None => Ok(()),
                }
            }
            C::UpdatePivot { id, .. }
            | C::ExpandCollapse { id, .. }
            | C::SetPageFilter { id, .. } => match self.pivot_sheet(*id) {
                Some(s) => self.deny_if(s, |p| p.pivot_tables),
                None => Ok(()),
            },
            C::RefreshPivot { id } => {
                let ids: Vec<u32> = match id {
                    Some(id) => vec![*id],
                    None => wb
                        .sheets()
                        .iter()
                        .flat_map(|(s, _)| wb.pivots(*s).iter().map(|p| p.id))
                        .collect(),
                };
                ids.into_iter()
                    .filter_map(|id| self.pivot_sheet(id))
                    .try_for_each(|s| self.deny_if(s, |p| p.pivot_tables))
            }
            // Slicers: objects; a table slicer's click is a filter.
            C::InsertSlicers { sheet, .. } => self.deny_if(*sheet, |p| p.objects),
            C::UpdateSlicer { id, .. } | C::DeleteSlicer { id } => {
                match wb.slicer(*id).map(|(s, _)| s.0) {
                    Some(s) => self.deny_if(s, |p| p.objects),
                    None => Ok(()),
                }
            }
            C::SetSlicerSelection { cache, .. } => {
                match wb.slicer_cache(cache).map(|c| &c.source) {
                    Some(model_sheet::SlicerSource::Table { table, .. }) => {
                        match self.table_sheet(*table) {
                            Some(s) => self.deny_if(s, |p| p.auto_filter),
                            None => Ok(()),
                        }
                    }
                    Some(model_sheet::SlicerSource::Pivot { pivots, .. }) => pivots
                        .iter()
                        .filter_map(|id| self.pivot_sheet(*id))
                        .try_for_each(|s| self.deny_if(s, |p| p.pivot_tables)),
                    None => Ok(()),
                }
            }
            // Protection itself, views, names, users and internal commands.
            _ => Ok(()),
        }
    }
}
