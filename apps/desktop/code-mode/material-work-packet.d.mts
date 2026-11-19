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
    /** Optional unique swatch identity for another hue of the same role.
     * An omitted swatchId is the primary swatch for that role. No global
     * palette-count restriction: one untrusted packet is byte-bounded. */
    swatchId?:string;
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
    /** Alternative to clusters, never both: explicit paintable/rest mask,
     * authored pixel-grid stroke paths, palette roles and bounded brush tips.
     * Rust is still the only physical UV/atlas and Paint authority.
     */
    brushComposition?:{
      mask:{
        reason:string;
        paintable:Array<{y:number;x0:number;x1:number}>;
        rest?:Array<{y:number;x0:number;x1:number}>;
      };
      strokes:Array<{
        id:string;
        /** Choose either an explicit swatch role, or walk one adjacent
         * existing shade role from a reviewer-selected anchor, never both.
         * The painter does not sample or infer the underlying source color.
         */
        role?:"deep_shadow"|"shadow"|"base"|"highlight"|"edge_light"|
          "accent"|"detail";
        /** Optional exact approved swatch; cannot be combined with shadeWalk. */
        swatchId?:string;
        shadeWalk?:{from:"deep_shadow"|"shadow"|"base"|"highlight"|"edge_light";
          steps:-1|1};
        formReason:string;
        /** Absolute positions on the selected Cube face, NOT atlas pixels. */
        points:Array<[number,number]>;
        /** An optional 3-anchor quadratic curved highlight/cloth fold
         * on the selected Cube face. Absent = original polyline. */
        pathKind?:"polyline"|"quadratic";
        /** Pixel radius (0–2), solid square or diamond dabs. */
        radius:number;tip:"square"|"diamond";
        /** Optional taper at both ends; preserves hard pixel edges. */
        taper:"none"|"ends";
      }>;
    };
    /** Mandatory for FORM_SHADING unless brushComposition is given;
     * connected pixel masks, never visual proof.
     */
    clusters?:Array<{
      id:string;
      role:"deep_shadow"|"shadow"|"base"|"highlight"|"edge_light"|
        "accent"|"detail";
      /** Exact approved swatch ID, otherwise use primary role swatch. */
      swatchId?:string;
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
/** Deterministic compiled source spans for Rust preflight; no native write. */
export declare function materialFaceClusters(
  face:MaterialWorkPacket["facePlans"][number],
  palette:MaterialWorkPacket["palette"]
):NonNullable<MaterialWorkPacket["facePlans"][number]["clusters"]>;
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
