import { describe, expect, test } from "bun:test";
import { createTextureVariant } from "@/server/runtime/contracts/texture";

/**
 * Disposable *fake* Blockbench globals, not a native Runtime test. The
 * current registered executor is invoked directly with fault injection.
 * Never claim this fixture proves the real Blockbench UndoSystem or renderer.
 */
type Fault =
  | "none" | "decode_reject" | "partial_from_data_url"
  | "add_throws" | "remove_throws" | "cancel_throws"
  | "foreign_texture" | "shadow_uuid" | "history_drift"
  | "project_swap" | "undo_swap" | "finish_throws_after_commit"
  | "postcommit_pixel_changed" | "postcommit_redraw_throws"
  | "redraw_source_pixel_drift" | "redraw_variant_pixel_drift"
  | "redraw_group_drift" | "redraw_foreign_texture"
  | "redraw_history_drift" | "redraw_project_swap"
  | "redraw_undo_swap" | "redraw_uv_drift"
  | "finish_before_commit_throws" | "finish_before_commit_aspects_dropped"
  | "finish_before_commit_variant_renamed" | "finished_event_variant_renamed"
  | "finished_event_variant_id_changed" | "finished_event_variant_channel_changed"
  | "finished_event_group_renamed" | "finished_event_group_material_changed"
  | "finished_event_group_removed" | "finished_event_undo_snapshot_erased"
  | "group_foreign_during_decode" | "group_renamed_during_decode"
  | "group_removed_during_decode" | "group_drift_on_remove"
  | "group_drift_on_cancel" | "group_foreign_after_commit"
  | "init_listener_throws" | "init_listener_replaces_save"
  | "init_listener_changes_source" | "init_listener_changes_groups"
  | "init_listener_changes_render" | "init_listener_adds_texture" | "init_listener_changes_history"
  | "init_listener_swaps_undo" | "add_listener_throws"
  | "add_listener_changes_source" | "add_listener_changes_wrap"
  | "add_listener_adds_foreign_texture"
  | "add_listener_swaps_undo" | "add_listener_renames_variant"
  | "decode_variant_frame_drift" | "finished_event_variant_render_drift"
  | "redraw_variant_sides_drift" | "finish_entry_mismatch" | "cancel_alters_history" | "remove_replaces_uuid" | "init_throws";

type FakeCase = {
  call: () => ReturnType<typeof createTextureVariant>;
  calls: { init: number; finish: number; cancel: number; remove: number; redraw: number; events: string[] };
  textures: Array<{ uuid: string; name: string }>;
  undo: {
    current_save: object | undefined;
    history: object[];
    index: number;
  };
  source: { uuid: string; pixels: Uint8ClampedArray };
};

async function withFakeBlockbench(
  fault: Fault,
  inspect: (ctx: FakeCase) => Promise<void>
): Promise<void> {
  const names = ["Project", "Texture", "TextureGroup", "Cube", "Undo", "Canvas"];
  const saved = names.map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  );
  const assign = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value,
    });
  const calls = {init: 0, finish: 0, cancel: 0, remove: 0, redraw: 0, events: [] as string[]};
  let counter = 0;
  let source!: FakeTexture;
  const project = {uuid:"project-a",texture_width:16,texture_height:16};
  const group = {uuid:"group",name:"Variants",is_material:false};
  const textureGroups = [group];
  const undo: FakeCase["undo"] & {
    initEdit: (aspects: unknown) => object;
    finishEdit: (name: string, aspects: unknown) => object | undefined;
    cancelEdit: () => void;
  } = {
    current_save: undefined,
    history: [], index: 0,
    initEdit(_aspects: unknown) {
      calls.init++;
      if (fault === "init_throws") throw new Error("INIT_FAILED");
      const aspects = _aspects as {textures: FakeTexture[]; collections: unknown[]};
      undo.current_save = {owner:"variant", aspects, textures:{}, collections:{}};
      // Native create_undo_save/init_edit listeners run while opening Undo.
      calls.events.push("init_edit");
      if (fault === "init_listener_throws") {
        throw new Error("INIT_LISTENER_THROW_AFTER_OPEN");
      }
      if (fault === "init_listener_replaces_save") {
        undo.current_save = {
          owner:"foreign", aspects:{textures:[],collections:[]},
          textures:{}, collections:{},
        };
      }
      if (fault === "init_listener_changes_source") source.pixels[0] = 255;
      if (fault === "init_listener_changes_groups") group.name = "Other";
      if (fault === "init_listener_changes_render") source.render_mode = "emissive";
      if (fault === "init_listener_adds_texture") {
        FakeTexture.all.push(new FakeTexture({name:"foreign.png",width:16,height:16}));
      }
      if (fault === "init_listener_changes_history") {
        undo.history.push({kind:"external"}); undo.index++;
      }
      if (fault === "init_listener_swaps_undo") assign("Undo",{...undo});
      return undo.current_save;
    },
    finishEdit(_name: string,_aspects: unknown) {
      calls.finish++;
      if (!undo.current_save) return undefined;
      // Match the two official UndoSystem event windows, not the native
      // Blockbench renderer or a complete Blockbench save implementation.
      calls.events.push("finish_edit");
      const candidate = FakeTexture.all.find(texture => texture !== source)!;
      if (fault === "finish_before_commit_throws") {
        throw new Error("FINISH_LISTENER_THROW_BEFORE_COMMIT");
      }
      if (fault === "finish_before_commit_aspects_dropped") {
        (_aspects as {textures:FakeTexture[]}).textures = [];
      }
      if (fault === "finish_before_commit_variant_renamed") {
        candidate.name = "unexpected_before_commit.png";
      }
      const aspects = _aspects as {textures: FakeTexture[]};
      const entry = {
        kind:"committed", before:undo.current_save,
        post:{textures:Object.fromEntries(aspects.textures.map(texture => [
          texture.uuid, {uuid:texture.uuid,name:texture.name},
        ]))},
      };
      if (undo.history.length > undo.index) undo.history.length = undo.index;
      undo.current_save = undefined;
      undo.history.push(entry);
      undo.index = undo.history.length;
      calls.events.push("finished_edit");
      if (fault === "postcommit_pixel_changed") source.pixels[0] = 201;
      if (fault === "finished_event_variant_renamed") candidate.name = "after.png";
      if (fault === "finished_event_variant_id_changed") candidate.id = "renamed-id";
      if (fault === "finished_event_variant_channel_changed") candidate.pbr_channel = "mer";
      if (fault === "finished_event_variant_render_drift") candidate.render_mode = "emissive";
      if (fault === "finished_event_group_renamed") group.name = "Other";
      if (fault === "finished_event_group_material_changed") group.is_material = true;
      if (fault === "finished_event_group_removed") textureGroups.length = 0;
      if (fault === "group_foreign_after_commit") {
        textureGroups.push({uuid:"foreign",name:"Other",is_material:false});
      }
      if (fault === "finished_event_undo_snapshot_erased") entry.post.textures = {};
      if (fault === "finish_throws_after_commit") {
        throw new Error("FINISH_FAILED_AFTER_COMMIT");
      }
      if (fault === "finish_entry_mismatch") return {kind:"wrong-entry"};
      return entry;
    },
    cancelEdit() {
      calls.cancel++;
      if (fault === "cancel_throws") throw new Error("CANCEL_FAILED");
      undo.current_save = undefined;
      if (fault === "group_drift_on_cancel") group.name = "changed_on_cancel";
      if (fault === "cancel_alters_history") {
        undo.history.push({kind:"foreign"});
        undo.index++;
      }
    },
  };

  class FakeTexture {
    static all: FakeTexture[] = [];
    uuid: string;
    id: string;
    name: string;
    width: number;
    height: number;
    display_height: number;
    uv_width: number;
    uv_height: number;
    group: string | null;
    pbr_channel: string;
    pixels: Uint8ClampedArray;
    render_mode = "default";
    render_sides = "front";
    wrap_mode = "clamp";
    frame_time = 1;
    frame_order_type = "loop";
    frame_order = "";
    frame_interpolate = false;
    internal = true;
    img: {decode: () => Promise<void>};

    constructor(opts: {
      name: string; width: number; height: number;
      group?: string; pbr_channel?: string;
    }) {
      this.name=opts.name;
      this.uuid=opts.name==="base.png" ? "base" : "variant-"+String(++counter);
      this.id=this.uuid;
      this.width=opts.width;
      this.height=opts.height;
      this.display_height=opts.height;
      this.uv_width=opts.width;
      this.uv_height=opts.height;
      this.group=opts.group ?? null;
      this.pbr_channel=opts.pbr_channel ?? "color";
      this.pixels=new Uint8ClampedArray(opts.width*opts.height*4);
      this.img={decode:async()=>{
        if (["decode_reject","remove_throws","cancel_throws",
             "cancel_alters_history","remove_replaces_uuid",
             "group_drift_on_remove","group_drift_on_cancel"].includes(fault)) {
          throw new Error("DECODE_FAILED");
        }
        if (fault==="foreign_texture") {
          FakeTexture.all.push(new FakeTexture({
            name:"foreign.png",width:16,height:16,
          }));
        }
        if (fault === "group_foreign_during_decode") {
          textureGroups.push({uuid:"foreign",name:"Other",is_material:false});
        }
        if (fault === "group_renamed_during_decode") group.name = "renamed";
        if (fault === "group_removed_during_decode") textureGroups.length = 0;
        if (fault === "decode_variant_frame_drift") this.frame_time = 3;
        if (fault==="shadow_uuid") {
          const shadow=new FakeTexture({name:"shadow.png",width:16,height:16});
          shadow.uuid=this.uuid;
          FakeTexture.all.push(shadow);
        }
        if (fault==="history_drift") {
          undo.history.push({kind:"other"});
          undo.index++;
        }
        if (fault==="project_swap") {
          assign("Project",{...project,uuid:"project-b"});
        }
        if (fault==="undo_swap") {
          undo.current_save={owner:"other"};
        }
      }};
    }
    get canvas() { return {width:this.width,height:this.height}; }
    get ctx() {
      return {getImageData:(_x:number,_y:number,_w:number,_h:number)=>({
        data:Uint8ClampedArray.from(this.pixels),
      })};
    }
    getUVWidth() {return this.uv_width;}
    getUVHeight() {return this.uv_height;}
    getDataURL() {return "data:image/png;base64,source";}

    fromDataURL(_data:string) {
      this.pixels=Uint8ClampedArray.from(source.pixels);
      if (fault==="partial_from_data_url") {
        FakeTexture.all.push(this);
        throw new Error("FROM_DATA_URL_PARTIAL");
      }
      return this;
    }
    add(_select?:boolean,_allowUndo?:boolean) {
      FakeTexture.all.push(this);
      // Official Texture.add dispatches add_texture after registration.
      calls.events.push("add_texture");
      if (fault==="add_throws") throw new Error("ADD_FAILED_AFTER_REGISTER");
      if (fault === "add_listener_throws") throw new Error("ADD_TEXTURE_LISTENER_THROW");
      if (fault === "add_listener_changes_source") source.pixels[0] = 255;
      if (fault === "add_listener_changes_wrap") source.wrap_mode = "repeat";
      if (fault === "add_listener_adds_foreign_texture") {
        FakeTexture.all.push(new FakeTexture({name:"foreign.png",width:16,height:16}));
      }
      if (fault === "add_listener_swaps_undo") assign("Undo",{...undo});
      if (fault === "add_listener_renames_variant") this.name = "renamed.png";
      return this;
    }
    remove(_undo?:boolean) {
      calls.remove++;
      if (fault==="remove_throws") throw new Error("REMOVE_FAILED");
      const index=FakeTexture.all.indexOf(this);
      if (index!==-1) FakeTexture.all.splice(index,1);
      if (fault === "group_drift_on_remove") group.name = "changed_on_remove";
      if (fault==="remove_replaces_uuid") {
        const replacement=new FakeTexture({
          name:"replacement.png",width:16,height:16,
        });
        replacement.uuid=this.uuid;
        FakeTexture.all.push(replacement);
      }
    }
  }
  source=new FakeTexture({name:"base.png",width:16,height:16});
  source.pixels.set([110,20,30,255,60,45,90,0]);
  FakeTexture.all.push(source);
  try {
    assign("Project",project);
    assign("Texture",FakeTexture);
    assign("TextureGroup",{all:textureGroups});
    assign("Cube",{all:[]});
    assign("Undo",undo);
    assign("Canvas",{updateAll(){
      calls.redraw++;
      if (fault==="postcommit_redraw_throws") throw new Error("REDRAW_FAILED");
      // The fake render handler stands in for a synchronous native listener.
      if (fault === "redraw_source_pixel_drift") source.pixels[0] = 251;
      if (fault === "redraw_variant_pixel_drift") {
        const candidate = FakeTexture.all.find(texture => texture !== source);
        if (candidate) candidate.pixels[0] = 251;
      }
      if (fault === "redraw_group_drift") group.name = "ChangedOnRender";
      if (fault === "redraw_foreign_texture") {
        FakeTexture.all.push(new FakeTexture({
          name:"foreign.png",width:16,height:16,
        }));
      }
      if (fault === "redraw_history_drift") {
        undo.history.push({kind:"foreign-render-edit"});
        undo.index = undo.history.length;
      }
      if (fault === "redraw_project_swap") {
        assign("Project",{...project});
      }
      if (fault === "redraw_undo_swap") assign("Undo",{...undo});
      if (fault === "redraw_uv_drift") project.texture_width = 32;
      if (fault === "redraw_variant_sides_drift") {
        const candidate = FakeTexture.all.find(texture => texture !== source);
        if (candidate) candidate.render_sides = "double";
      }
    }});
    await inspect({
      call:()=>createTextureVariant({
        type:"variant",name:"variant.png",source_texture_id:"base",group:"group",
      }),
      calls,textures:FakeTexture.all,undo,source,
    });
  } finally {
    for (const [name,descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis,name,descriptor);
      else Reflect.deleteProperty(globalThis,name);
    }
  }
}

describe("V1 partial-registration and recovery fake-native fault injection",()=>{
  test("success path emits creation-time receipt but never user/visual approval",async()=>{
    await withFakeBlockbench("none",async ctx=>{
      const result=await ctx.call();
      expect(result.structuredContent.variant_native_continuity).toMatchObject({
        state:"RUNTIME_PRECOMMIT_VARIANT_CONTINUITY_OBSERVED",
        visual_verified:false,minecraft_verified:false,
      });
      expect(ctx.textures).toHaveLength(2);
      expect(ctx.calls).toMatchObject({init:1,finish:1,cancel:0,remove:0});
      expect(ctx.undo.current_save).toBeUndefined();
      expect(ctx.calls.events).toEqual([
          "init_edit","add_texture","finish_edit","finished_edit",
        ]);
      expect(ctx.undo.history[0]).toMatchObject({
        before:{textures:{}},
        post:{textures:{"variant-1":{uuid:"variant-1",name:"variant.png"}}},
      });
    });
  });

  test("init_edit listener drift never starts candidate creation or cancels an unknown edit",async()=>{
    for (const fault of [
      "init_listener_throws", "init_listener_replaces_save",
      "init_listener_changes_source", "init_listener_changes_groups",
      "init_listener_adds_texture", "init_listener_changes_render",
      "init_listener_changes_history",
      "init_listener_swaps_undo",
    ] as const) {
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_UNDO_INIT_OUTCOME_UNKNOWN");
        expect(ctx.calls).toMatchObject({init:1,finish:0,cancel:0,remove:0});
        expect(ctx.calls.events).toEqual(["init_edit"]);
        expect(ctx.undo.current_save).toBeDefined();
      });
    }
  });

  test("add_texture listener may fail after registration but only owned edits rollback",async()=>{
    for (const fault of ["add_listener_throws","add_listener_renames_variant"] as const) {
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow(
          fault === "add_listener_throws"
            ? "ADD_TEXTURE_LISTENER_THROW" : "TEXTURE_VARIANT_ADD_TEXTURE_STATE_DRIFT"
        );
        expect(ctx.calls).toMatchObject({init:1,finish:0,cancel:1,remove:1});
        expect(ctx.calls.events).toEqual(["init_edit","add_texture"]);
        expect(ctx.textures).toHaveLength(1);
      });
    }
  });

  test("foreign add_texture listener mutations cannot roll back another owner",async()=>{
    for (const fault of [
      "add_listener_changes_source","add_listener_changes_wrap",
      "add_listener_adds_foreign_texture", "add_listener_swaps_undo",
    ] as const) {
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
        expect(ctx.calls).toMatchObject({init:1,finish:0,cancel:0,remove:0});
        expect(ctx.calls.events).toEqual(["init_edit","add_texture"]);
      });
    }
  });

  test("decoder visual-setting drift rolls back only the owned candidate",async()=>{
    await withFakeBlockbench("decode_variant_frame_drift", async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_NATIVE_APPEARANCE_DRIFT");
      expect(ctx.calls).toMatchObject({init:1,finish:0,remove:1,cancel:1});
      expect(ctx.textures).toHaveLength(1);
      expect(ctx.textures[0]).toBe(ctx.source);
    });
  });

  test("decoder and partially failing add rollback only the owned candidate",async()=>{
    for(const fault of ["decode_reject","add_throws"] as const){
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow(
          fault==="decode_reject"?"DECODE_FAILED":"ADD_FAILED_AFTER_REGISTER"
        );
        expect(ctx.textures).toHaveLength(1);
        expect(ctx.textures[0]).toBe(ctx.source);
        expect(ctx.calls).toMatchObject({init:1,finish:0,cancel:1,remove:1});
        expect(ctx.undo.history).toHaveLength(0);
        expect(ctx.undo.current_save).toBeUndefined();
      });
    }
  });

  test("partially registered object before assignment refuses automatic cleanup",async()=>{
    await withFakeBlockbench("partial_from_data_url",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.textures).toHaveLength(2);
      expect(ctx.calls.cancel).toBe(0);
      expect(ctx.calls.remove).toBe(0);
      expect(ctx.undo.current_save).toBeDefined();
    });
  });

  test("foreign Texture or duplicate UUID during decode forces inspection",async()=>{
    for(const fault of ["foreign_texture","shadow_uuid"] as const){
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
        expect(ctx.textures.length).toBe(3);
        expect(ctx.calls.remove).toBe(0);
        expect(ctx.calls.cancel).toBe(0);
      });
    }
  });

  test("project, Undo ownership or history drift cannot rollback another edit",async()=>{
    for(const fault of ["project_swap","undo_swap","history_drift"] as const){
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
        expect(ctx.calls.cancel).toBe(0);
        expect(ctx.calls.remove).toBe(0);
        expect(ctx.textures.length).toBe(2);
      });
    }
  });

  test("foreign TextureGroup edits during decode forbid finish or rollback",async()=>{
    for (const fault of [
      "group_foreign_during_decode", "group_renamed_during_decode",
      "group_removed_during_decode",
    ] as const) {
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
        expect(ctx.calls).toMatchObject({init:1,finish:0,cancel:0,remove:0});
        expect(ctx.textures).toHaveLength(2);
      });
    }
  });

  test("TextureGroup changes during cleanup invalidate rollback ownership",async()=>{
    await withFakeBlockbench("group_drift_on_remove",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_ROLLBACK_UNVERIFIED");
      expect(ctx.calls).toMatchObject({init:1,finish:0,remove:1,cancel:0});
      expect(ctx.textures).toHaveLength(1);
    });
    await withFakeBlockbench("group_drift_on_cancel",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_ROLLBACK_UNVERIFIED");
      expect(ctx.calls).toMatchObject({init:1,finish:0,remove:1,cancel:1});
      expect(ctx.textures).toHaveLength(1);
    });
  });

  test("foreign TextureGroup addition after native commit is not receipt success",async()=>{
    await withFakeBlockbench("group_foreign_after_commit",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.calls).toMatchObject({init:1,finish:1,cancel:0,remove:0});
      expect(ctx.textures).toHaveLength(2);
    });
  });

  test("remove, cancel and post-cancel history corruption are ROLLBACK_UNVERIFIED",async()=>{
    for(const fault of ["remove_throws","cancel_throws","cancel_alters_history",
      "remove_replaces_uuid"] as const){
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_ROLLBACK_UNVERIFIED");
        expect(ctx.calls.finish).toBe(0);
      });
    }
  });

  test("finishEdit can commit before throwing and is never rolled back automatically",async()=>{
    await withFakeBlockbench("finish_throws_after_commit",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.calls).toMatchObject({init:1,finish:1,cancel:0,remove:0});
      expect(ctx.undo.history).toHaveLength(1);
      expect(ctx.textures).toHaveLength(2);
    });
  });

  test("finish_edit listeners run before post snapshot and cannot claim success",async()=>{
    for(const fault of ["finish_before_commit_aspects_dropped",
      "finish_before_commit_variant_renamed"] as const){
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
        expect(ctx.calls.events).toEqual([
          "init_edit","add_texture","finish_edit","finished_edit",
        ]);
        expect(ctx.undo.history).toHaveLength(1);
        expect(ctx.calls.cancel).toBe(0);
        expect(ctx.calls.remove).toBe(0);
      });
    }
  });

  test("a throwing finish_edit listener before commit still has unknown outcome",async()=>{
    await withFakeBlockbench("finish_before_commit_throws",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.calls.events).toEqual(["init_edit","add_texture","finish_edit"]);
      expect(ctx.undo.history).toHaveLength(0);
      expect(ctx.undo.current_save).toBeDefined();
      expect(ctx.calls.cancel).toBe(0);
      expect(ctx.calls.remove).toBe(0);
    });
  });

  test("finished_edit cannot silently change exact variant or group",async()=>{
    for(const fault of [
      "finished_event_variant_renamed", "finished_event_variant_id_changed",
      "finished_event_variant_channel_changed", "finished_event_variant_render_drift",
      "finished_event_group_renamed",
      "finished_event_group_material_changed", "finished_event_group_removed",
    ] as const){
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
        expect(ctx.calls.events).toEqual([
          "init_edit","add_texture","finish_edit","finished_edit",
        ]);
        expect(ctx.undo.history).toHaveLength(1);
        expect(ctx.calls).toMatchObject({finish:1,cancel:0,remove:0});
        expect(ctx.textures).toHaveLength(2);
      });
    }
  });

  test("finished_edit cannot erase the committed native Undo texture snapshot",async()=>{
    await withFakeBlockbench("finished_event_undo_snapshot_erased",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.undo.history).toHaveLength(1);
      expect(ctx.calls).toMatchObject({finish:1,cancel:0,remove:0});
    });
  });

  test("finishEdit result must match the active native Undo history entry",async()=>{
    await withFakeBlockbench("finish_entry_mismatch",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.calls.finish).toBe(1);
      expect(ctx.calls.cancel).toBe(0);
      expect(ctx.calls.remove).toBe(0);
      expect(ctx.textures).toHaveLength(2);
    });
  });

  test("postcommit listener edits refuse success; redraw failure never retries",async()=>{
    await withFakeBlockbench("postcommit_pixel_changed",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
      expect(ctx.calls.finish).toBe(1);
      expect(ctx.calls.cancel).toBe(0);
      expect(ctx.textures).toHaveLength(2);
    });
    await withFakeBlockbench("postcommit_redraw_throws",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_POSTCOMMIT_DISPLAY_UNVERIFIED");
      expect(ctx.calls.finish).toBe(1);
      expect(ctx.calls.cancel).toBe(0);
      expect(ctx.textures).toHaveLength(2);
    });
  });

  test("redraw listeners cannot invalidate a committed receipt or start rollback",async()=>{
    for (const fault of [
      "redraw_source_pixel_drift", "redraw_variant_pixel_drift",
      "redraw_group_drift", "redraw_foreign_texture",
      "redraw_history_drift", "redraw_project_swap",
      "redraw_undo_swap", "redraw_uv_drift", "redraw_variant_sides_drift",
    ] as const) {
      await withFakeBlockbench(fault,async ctx=>{
        await expect(ctx.call()).rejects.toThrow(
          "TEXTURE_VARIANT_POSTCOMMIT_DISPLAY_UNVERIFIED"
        );
        expect(ctx.calls).toMatchObject({
          init:1, finish:1, cancel:0, remove:0, redraw:1,
        });
        expect(ctx.calls.events).toEqual([
          "init_edit", "add_texture", "finish_edit", "finished_edit",
        ]);
        expect(ctx.textures.length).toBeGreaterThanOrEqual(2);
        expect(ctx.undo.history.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  test("unknown initEdit outcome is not reinterpreted as safe retry",async()=>{
    await withFakeBlockbench("init_throws",async ctx=>{
      await expect(ctx.call()).rejects.toThrow("TEXTURE_VARIANT_UNDO_INIT_OUTCOME_UNKNOWN");
      expect(ctx.calls.finish).toBe(0);
      expect(ctx.calls.cancel).toBe(0);
      expect(ctx.textures).toHaveLength(1);
    });
  });
});
