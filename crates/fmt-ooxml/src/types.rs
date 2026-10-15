//! Well-known relationship types ([`rel`]) and content types ([`ct`]) of
//! the parts the format crates read and write (ECMA-376 transitional).
//!
//! Readers should not compare relationship types against these constants
//! alone when they also accept Strict files (`http://purl.oclc.org/ooxml/…`);
//! the last path segment is the same in both conformance classes.

/// Relationship types (`Relationship/@Type`).
pub mod rel {
    macro_rules! office_rel {
        ($kind:literal) => {
            concat!(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/",
                $kind
            )
        };
    }

    /// The relationships namespace, also bound to the `r:` prefix in part
    /// XML (`r:id`, `r:embed`). Relationship types below extend it.
    pub const NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    /// Package → main part (`workbook.xml`, `document.xml`, `presentation.xml`).
    pub const OFFICE_DOCUMENT: &str = crate::OFFICE_DOCUMENT_REL;
    /// Package → `docProps/core.xml`.
    pub const CORE_PROPERTIES: &str =
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
    /// Package → `docProps/app.xml`.
    pub const EXTENDED_PROPERTIES: &str = office_rel!("extended-properties");
    /// Main part → theme part.
    pub const THEME: &str = office_rel!("theme");
    /// Main part → styles part (SpreadsheetML and WordprocessingML).
    pub const STYLES: &str = office_rel!("styles");
    /// Any part → image media.
    pub const IMAGE: &str = office_rel!("image");
    /// Any part → external hyperlink target.
    pub const HYPERLINK: &str = office_rel!("hyperlink");

    /// Workbook → worksheet.
    pub const WORKSHEET: &str = office_rel!("worksheet");
    /// Workbook → shared string table.
    pub const SHARED_STRINGS: &str = office_rel!("sharedStrings");

    /// Document → numbering part.
    pub const NUMBERING: &str = office_rel!("numbering");
    /// Document → settings part.
    pub const SETTINGS: &str = office_rel!("settings");
    /// Document → header part.
    pub const HEADER: &str = office_rel!("header");
    /// Document → footer part.
    pub const FOOTER: &str = office_rel!("footer");

    /// Presentation / notes slide → slide.
    pub const SLIDE: &str = office_rel!("slide");
    /// Slide master / slide → slide layout.
    pub const SLIDE_LAYOUT: &str = office_rel!("slideLayout");
    /// Presentation / layout → slide master.
    pub const SLIDE_MASTER: &str = office_rel!("slideMaster");
    /// Slide → notes slide.
    pub const NOTES_SLIDE: &str = office_rel!("notesSlide");
    /// Presentation / notes slide → notes master.
    pub const NOTES_MASTER: &str = office_rel!("notesMaster");
    /// Presentation → `presProps.xml`.
    pub const PRES_PROPS: &str = office_rel!("presProps");
    /// Presentation → `viewProps.xml`.
    pub const VIEW_PROPS: &str = office_rel!("viewProps");
    /// Presentation → `tableStyles.xml`.
    pub const TABLE_STYLES: &str = office_rel!("tableStyles");

    /// Worksheet → drawing part (`xl/drawings/drawingN.xml`).
    pub const DRAWING: &str = office_rel!("drawing");
    /// Drawing / slide → chart part (`c:chartSpace`).
    pub const CHART: &str = office_rel!("chart");
    /// Chart → Office 2013 chart style part (`chartStyle`, cosmetic).
    pub const CHART_STYLE: &str =
        "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
    /// Chart → Office 2013 chart color style part (`chartColorStyle`).
    pub const CHART_COLOR_STYLE: &str =
        "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";
}

/// Content types (`[Content_Types].xml` overrides).
pub mod ct {
    macro_rules! office_ct {
        ($kind:literal) => {
            concat!(
                "application/vnd.openxmlformats-officedocument.",
                $kind,
                "+xml"
            )
        };
    }

    /// `docProps/core.xml`.
    pub const CORE_PROPERTIES: &str = "application/vnd.openxmlformats-package.core-properties+xml";
    /// `docProps/app.xml`.
    pub const EXTENDED_PROPERTIES: &str = office_ct!("extended-properties");
    /// Theme part (all formats).
    pub const THEME: &str = office_ct!("theme");

    /// `xl/workbook.xml`.
    pub const WORKBOOK: &str = office_ct!("spreadsheetml.sheet.main");
    /// `xl/worksheets/sheetN.xml`.
    pub const WORKSHEET: &str = office_ct!("spreadsheetml.worksheet");
    /// `xl/styles.xml`.
    pub const SPREADSHEET_STYLES: &str = office_ct!("spreadsheetml.styles");
    /// `xl/sharedStrings.xml`.
    pub const SHARED_STRINGS: &str = office_ct!("spreadsheetml.sharedStrings");

    /// `word/document.xml`.
    pub const DOCUMENT: &str = office_ct!("wordprocessingml.document.main");
    /// `word/styles.xml`.
    pub const WORD_STYLES: &str = office_ct!("wordprocessingml.styles");
    /// `word/numbering.xml`.
    pub const NUMBERING: &str = office_ct!("wordprocessingml.numbering");
    /// `word/settings.xml`.
    pub const SETTINGS: &str = office_ct!("wordprocessingml.settings");
    /// `word/headerN.xml`.
    pub const HEADER: &str = office_ct!("wordprocessingml.header");
    /// `word/footerN.xml`.
    pub const FOOTER: &str = office_ct!("wordprocessingml.footer");

    /// `ppt/presentation.xml`.
    pub const PRESENTATION: &str = office_ct!("presentationml.presentation.main");
    /// `ppt/slides/slideN.xml`.
    pub const SLIDE: &str = office_ct!("presentationml.slide");
    /// `ppt/slideLayouts/slideLayoutN.xml`.
    pub const SLIDE_LAYOUT: &str = office_ct!("presentationml.slideLayout");
    /// `ppt/slideMasters/slideMasterN.xml`.
    pub const SLIDE_MASTER: &str = office_ct!("presentationml.slideMaster");
    /// `ppt/notesSlides/notesSlideN.xml`.
    pub const NOTES_SLIDE: &str = office_ct!("presentationml.notesSlide");
    /// `ppt/notesMasters/notesMasterN.xml`.
    pub const NOTES_MASTER: &str = office_ct!("presentationml.notesMaster");
    /// `ppt/presProps.xml`.
    pub const PRES_PROPS: &str = office_ct!("presentationml.presProps");
    /// `ppt/viewProps.xml`.
    pub const VIEW_PROPS: &str = office_ct!("presentationml.viewProps");
    /// `ppt/tableStyles.xml`.
    pub const TABLE_STYLES: &str = office_ct!("presentationml.tableStyles");

    /// `xl/drawings/drawingN.xml` (SpreadsheetML drawing).
    pub const DRAWING: &str = office_ct!("drawing");
    /// `*/charts/chartN.xml`.
    pub const CHART: &str = office_ct!("drawingml.chart");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spelled_out() {
        assert_eq!(
            rel::WORKSHEET,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
        );
        assert!(rel::SHARED_STRINGS.starts_with(rel::NS));
        assert_eq!(
            ct::DOCUMENT,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
        );
        assert_eq!(
            ct::THEME,
            "application/vnd.openxmlformats-officedocument.theme+xml"
        );
        assert_eq!(
            ct::SLIDE,
            "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
        );
    }
}
