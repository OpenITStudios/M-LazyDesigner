/** Source-only artist-plan schema. It is a guest PROPOSAL, never reference,
 * lighting, 3D-form or mapped-view PASS. Rust owns all real paint/UV data.
 */
export interface MaterialWorkPacket {
  sourceModelSha256:string;
  referencePngSha256:string;
  issueId:string;approachId:string;partId:string;
  textureUuid:string;
  material:"metal"|"wood"|"stone"|"cloth"|"skin"|"glass"|"other";
  shadingIntent:"FORM_SHADING"|"SURFACE_DETAIL"|"ALPHA_SILHOUETTE";
  /** Must match the latest exact trusted-reviewer issue observation. */
  reviewedIssueObservation:string;
  styleIntent:string;lightDirection:string;lightRationale:string;
  palette:Array<{
    role:"deep_shadow"|"shadow"|"base"|"highlight"|"edge_light"|
      "accent"|"detail";
    rgb:[number,number,number];
    purpose:string;
  }>;
  /** Atlas rectangles must EXACTLY match the correction scope;
   * Cube-local operations are mapped by Rust's guarded Paint owner.
   */
  facePlans:Array<{
    cubeUuid:string;
    face:"north"|"east"|"south"|"west"|"up"|"down";
    atlasRegion:{from:[number,number];to:[number,number]};
    formCue:string;
    shadowPlacement?:string;
    highlightPlacement?:string;
    clusterPlan:string;
    /** Mandatory for FORM_SHADING, optional for separately declared
     * SURFACE_DETAIL; source-only connected pixel masks, never visual proof.
     */
    clusters?:Array<{
      id:string;
      role:"deep_shadow"|"shadow"|"base"|"highlight"|"edge_light"|
        "accent"|"detail";
      formReason:string;
      /** Integer pixel runs in Cube FACE-LOCAL coordinates, not atlas UV. */
      spans:Array<{y:number;x0:number;x1:number}>;
    }>;
  }>;
}
export declare function normalizedMaterialWorkPacket(
  packet?:MaterialWorkPacket
):Readonly<MaterialWorkPacket>|undefined;
export declare function materialWorkPacketDigest(packet:MaterialWorkPacket):string;
/** Deterministic host-only FORM_SHADING cluster compiler. Generates exactly
 * the existing Rust guarded face-local Paint operation family, never writes.
 */
export declare function compileMaterialClusterPaint(packet:MaterialWorkPacket):
  Array<{
    op:"paint_cube_face_regions_guarded";
    cube_uuid:string;texture_uuid:string;
    regions:Array<{
      face:"north"|"east"|"south"|"west"|"up"|"down";
      from:[number,number];to:[number,number];
      rgba:[number,number,number,number];erase:false;
    }>;
  }>;
/** Source plan to Rust guarded operation correspondence, NOT visual quality. */
export declare function validateMaterialWorkPacketOperations(
  packet:Readonly<MaterialWorkPacket>,
  correctionScope:{
    texture_uuid:string;
    allowed_regions:Array<{from:[number,number];to:[number,number]}>;
    preserve_alpha:boolean;
  },
  operations:Array<Record<string,unknown>>
):true;
