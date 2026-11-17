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
  }>;
}
export declare function normalizedMaterialWorkPacket(
  packet?:MaterialWorkPacket
):Readonly<MaterialWorkPacket>|undefined;
export declare function materialWorkPacketDigest(packet:MaterialWorkPacket):string;
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
