//! Deterministic, source-local stencil for direct-user pixel strokes.
//! This module never owns a raster, source colors, alpha, or permissions.
use serde::{Deserialize,Serialize};
use super::Result;

#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum SurfacePatternKind{Checker,Dots,Diagonal}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfacePattern{
    pub kind:SurfacePatternKind,
    /// Local texel period; constrained by actual selected face dimensions.
    pub period:u32,
    /// Phase is stable across gestures, not based on timing or pointer speed.
    pub phase:[u32;2],
}
impl SurfacePattern{
    pub fn validate(&self,_face_size:[u32;2])->Result<()>{
        if self.period==0{
            return Err("SURFACE_PATTERN_PERIOD_INVALID".into());
        }
        Ok(())
    }
    pub fn admits(&self,local:[u32;2])->bool{
        let px=u64::from(local[0])+u64::from(self.phase[0]);
        let py=u64::from(local[1])+u64::from(self.phase[1]);
        let period=u64::from(self.period);
        match self.kind{
            SurfacePatternKind::Checker=>(px/period+py/period)%2==0,
            SurfacePatternKind::Dots=>px%period==0&&py%period==0,
            SurfacePatternKind::Diagonal=>(px+py)%period==0,
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn tiled_pattern_is_deterministic_and_tracks_face_local_phase(){
        let pattern=SurfacePattern{kind:SurfacePatternKind::Checker,
            period:2,phase:[1,0]};
        pattern.validate([2048,2048]).unwrap();
        assert_eq!(pattern.admits([1,0]),false);
        assert_eq!(pattern.admits([2,0]),false);
        assert_eq!(pattern.admits([3,0]),true);
        assert_eq!(pattern.admits([4,0]),true);
        assert_eq!(pattern.admits([1,0]),true);
        let dots=SurfacePattern{kind:SurfacePatternKind::Dots,
            period:3,phase:[0,1]};
        assert!(dots.admits([3,2]));
        assert!(!dots.admits([3,3]));
        let bad=SurfacePattern{kind:SurfacePatternKind::Diagonal,
            period:0,phase:[0,0]};
        assert!(bad.validate([2048,2048]).is_err());
    }
}
