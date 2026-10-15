//! Mapping of SpreadsheetML `theme="N"` color indices to theme slots. The
//! theme part itself is parsed and written by [`fmt_ooxml::theme`].

use core_model::ThemeColorSlot;

/// SpreadsheetML theme color index → slot. Excel swaps the dark/light
/// pairs relative to the scheme order: 0 = `lt1`, 1 = `dk1`, 2 = `lt2`,
/// 3 = `dk2`, then accents and hyperlinks.
pub fn slot_from_index(i: u32) -> Option<ThemeColorSlot> {
    use ThemeColorSlot::*;
    Some(match i {
        0 => Light1,
        1 => Dark1,
        2 => Light2,
        3 => Dark2,
        4 => Accent1,
        5 => Accent2,
        6 => Accent3,
        7 => Accent4,
        8 => Accent5,
        9 => Accent6,
        10 => Hyperlink,
        11 => FollowedHyperlink,
        _ => return None,
    })
}

/// Inverse of [`slot_from_index`].
pub fn index_of_slot(slot: ThemeColorSlot) -> u32 {
    (0..12)
        .find(|&i| slot_from_index(i) == Some(slot))
        .expect("every slot has an index")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_mapping() {
        assert_eq!(slot_from_index(0), Some(ThemeColorSlot::Light1));
        assert_eq!(slot_from_index(1), Some(ThemeColorSlot::Dark1));
        assert_eq!(slot_from_index(4), Some(ThemeColorSlot::Accent1));
        assert_eq!(slot_from_index(12), None);
        for slot in ThemeColorSlot::ALL {
            assert_eq!(slot_from_index(index_of_slot(slot)), Some(slot));
        }
    }
}
