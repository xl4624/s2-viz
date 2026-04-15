open Core
open Js_of_ocaml

(* JS global access helpers *)
let window = Js.Unsafe.global

let set_text id text =
  let el =
    (Js.Unsafe.meth_call
       Js.Unsafe.global##.document
       "getElementById"
       [| Js.Unsafe.inject (Js.string id) |]
     : Js.Unsafe.any)
  in
  Js.Unsafe.set el (Js.string "textContent") (Js.string text)
;;

let get_checkbox id =
  let el =
    (Js.Unsafe.meth_call
       Js.Unsafe.global##.document
       "getElementById"
       [| Js.Unsafe.inject (Js.string id) |]
     : Js.Unsafe.any)
  in
  Js.to_bool (Js.Unsafe.coerce (Js.Unsafe.get el (Js.string "checked")))
;;

let get_slider_int id =
  let el =
    (Js.Unsafe.meth_call
       Js.Unsafe.global##.document
       "getElementById"
       [| Js.Unsafe.inject (Js.string id) |]
     : Js.Unsafe.any)
  in
  let v = Js.Unsafe.get el (Js.string "value") in
  int_of_string (Js.to_string (Js.Unsafe.coerce v))
;;

(* JS renderer calls *)
let raycast x y : (float * float * float) option =
  let result : Js.Unsafe.any =
    Js.Unsafe.fun_call
      (Js.Unsafe.get window (Js.string "_s2viz_raycast"))
      [| Js.Unsafe.inject x; Js.Unsafe.inject y |]
  in
  if Js.Unsafe.equals result Js.null
  then None
  else (
    let gf i = Js.float_of_number (Js.Unsafe.coerce (Js.Unsafe.get result i)) in
    Some (gf 0, gf 1, gf 2))
;;

let clear_cells () =
  Js.Unsafe.fun_call (Js.Unsafe.get window (Js.string "_s2viz_clear_cells")) [||]
  |> ignore
;;

let add_cell_js (vertices : float array) fill_color line_color =
  let js_arr = new%js Js.array_empty in
  Array.iter vertices ~f:(fun v ->
    ignore (Js.Unsafe.meth_call js_arr "push" [| Js.Unsafe.inject v |]));
  Js.Unsafe.fun_call
    (Js.Unsafe.get window (Js.string "_s2viz_add_cell"))
    [| Js.Unsafe.inject js_arr
     ; Js.Unsafe.inject fill_color
     ; Js.Unsafe.inject line_color
    |]
  |> ignore
;;

let hide_pick_info () =
  Js.Unsafe.fun_call (Js.Unsafe.get window (Js.string "_s2viz_hide_pick_info")) [||]
  |> ignore
;;

let clear_pick () =
  Js.Unsafe.fun_call (Js.Unsafe.get window (Js.string "_s2viz_clear_pick")) [||]
  |> ignore
;;

let show_pick_js (vertices : float array) line_color =
  let js_arr = new%js Js.array_empty in
  Array.iter vertices ~f:(fun v ->
    ignore (Js.Unsafe.meth_call js_arr "push" [| Js.Unsafe.inject v |]));
  Js.Unsafe.fun_call
    (Js.Unsafe.get window (Js.string "_s2viz_show_pick"))
    [| Js.Unsafe.inject js_arr; Js.Unsafe.inject line_color |]
  |> ignore
;;

let set_pick_info_js token level face lat lng =
  Js.Unsafe.fun_call
    (Js.Unsafe.get window (Js.string "_s2viz_set_pick_info"))
    [| Js.Unsafe.inject (Js.string token)
     ; Js.Unsafe.inject level
     ; Js.Unsafe.inject face
     ; Js.Unsafe.inject lat
     ; Js.Unsafe.inject lng
    |]
  |> ignore
;;

let show_selection cx cy cz radius =
  Js.Unsafe.fun_call
    (Js.Unsafe.get window (Js.string "_s2viz_show_selection"))
    [| Js.Unsafe.inject cx
     ; Js.Unsafe.inject cy
     ; Js.Unsafe.inject cz
     ; Js.Unsafe.inject radius
    |]
  |> ignore
;;

(* Fill [vertices] starting at [start] with [pts_per_edge] interpolated points
   from v0 to v1, projected to the unit sphere. *)
let[@zero_alloc] fill_edge vertices ~start ~pts_per_edge ~inv_steps v0 v1 =
  let x0 = S2.R3_vector.x v0 in
  let y0 = S2.R3_vector.y v0 in
  let z0 = S2.R3_vector.z v0 in
  let dx = Float_u.O.(S2.R3_vector.x v1 - x0) in
  let dy = Float_u.O.(S2.R3_vector.y v1 - y0) in
  let dz = Float_u.O.(S2.R3_vector.z v1 - z0) in
  for i = 0 to pts_per_edge - 1 do
    let open Float_u.O in
    let t = Float_u.of_int i * inv_steps in
    let px = x0 + (t * dx) in
    let py = y0 + (t * dy) in
    let pz = z0 + (t * dz) in
    let inv_len = #1.0 / Float_u.sqrt ((px * px) + (py * py) + (pz * pz)) in
    let j = Stdlib.(start + (i * 3)) in
    vertices.(j) <- Float_u.to_float (px * inv_len);
    vertices.(Stdlib.(j + 1)) <- Float_u.to_float (py * inv_len);
    vertices.(Stdlib.(j + 2)) <- Float_u.to_float (pz * inv_len)
  done
;;

(* S2 cell boundary: 4 corners interpolated into n points per edge for smooth arcs *)
let cell_boundary_vertices (cell_id : S2.S2_cell_id.t) : float array =
  let cell = S2.S2_cell.of_cell_id cell_id in
  let pts_per_edge = 8 in
  let vertices = Array.create ~len:(4 * pts_per_edge * 3) 0.0 in
  let inv_steps = Float_u.O.(#1.0 / Float_u.of_int pts_per_edge) in
  for edge = 0 to 3 do
    let v0 = S2.S2_cell.vertex cell edge in
    let v1 = S2.S2_cell.vertex cell ((edge + 1) mod 4) in
    fill_edge vertices
      ~start:(edge * pts_per_edge * 3)
      ~pts_per_edge ~inv_steps v0 v1
  done;
  vertices
;;


(* State *)
let selection_center : (float * float * float) option ref = ref None
let selection_radius = ref 0.0
let is_selecting = ref false
let pick_point : (float * float * float) option ref = ref None

let angle_between (x0, y0, z0) (x1, y1, z1) =
  let dot = (x0 *. x1) +. (y0 *. y1) +. (z0 *. z1) in
  Float.acos (Float.clamp_exn dot ~min:(-1.0) ~max:1.0)
;;

let update_covering () =
  clear_cells ();
  match !selection_center with
  | None -> set_text "cell-count" "0"
  | Some (cx, cy, cz) ->
    let radius = !selection_radius in
    if Float.(radius <= 0.0)
    then set_text "cell-count" "0"
    else (
      let max_level = get_slider_int "level-slider" in
      let max_cells = get_slider_int "maxcells-slider" in
      set_text "level-val" (string_of_int max_level);
      set_text "maxcells-val" (string_of_int max_cells);
      let center =
        S2.R3_vector.create
          ~x:(Float_u.of_float cx)
          ~y:(Float_u.of_float cy)
          ~z:(Float_u.of_float cz)
      in
      let cap =
        S2.S2_cap.of_center_angle
          center
          (S2.S1_angle.of_radians (Float_u.of_float radius))
      in
      let rc = S2.S2_region_coverer.create ~max_level ~max_cells () in
      let region = S2.S2_region.of_cap cap in
      let interior = get_checkbox "interior-toggle" in
      let covering =
        if interior
        then S2.S2_region_coverer.interior_covering rc region
        else S2.S2_region_coverer.covering rc region
      in
      let line_color = if interior then 0x1a66cc else 0x003d1a in
      let n = S2.S2_cell_union.num_cells covering in
      set_text "cell-count" (string_of_int n);
      for i = 0 to n - 1 do
        let cid = S2.S2_cell_union.cell_id covering i in
        let verts = cell_boundary_vertices cid in
        add_cell_js verts 0x006633 line_color
      done;
      show_selection cx cy cz radius)
;;

let pick_color = 0xffff00

let render_pick () =
  match !pick_point with
  | None -> ()
  | Some (px, py, pz) ->
    let pt =
      S2.R3_vector.create
        ~x:(Float_u.of_float px)
        ~y:(Float_u.of_float py)
        ~z:(Float_u.of_float pz)
    in
    let level = get_slider_int "level-slider" in
    let leaf = S2.S2_cell_id.from_point pt in
    let cid = S2.S2_cell_id.parent_level leaf level in
    let verts = cell_boundary_vertices cid in
    clear_pick ();
    show_pick_js verts pick_color;
    let ll = S2.S2_latlng.of_point pt in
    let lat = Float_u.to_float (S2.S1_angle.degrees (S2.S2_latlng.lat ll)) in
    let lng = Float_u.to_float (S2.S1_angle.degrees (S2.S2_latlng.lng ll)) in
    set_pick_info_js
      (S2.S2_cell_id.to_token cid)
      (S2.S2_cell_id.level cid)
      (S2.S2_cell_id.face cid)
      lat
      lng
;;

let cell_id_of_point (px, py, pz) ~level =
  let pt =
    S2.R3_vector.create
      ~x:(Float_u.of_float px)
      ~y:(Float_u.of_float py)
      ~z:(Float_u.of_float pz)
  in
  S2.S2_cell_id.parent_level (S2.S2_cell_id.from_point pt) level
;;

let on_pick x y =
  match raycast (float_of_int x) (float_of_int y) with
  | None -> ()
  | Some new_pt ->
    let level = get_slider_int "level-slider" in
    let same_cell =
      match !pick_point with
      | None -> false
      | Some prev_pt ->
        S2.S2_cell_id.equal
          (cell_id_of_point new_pt ~level)
          (cell_id_of_point prev_pt ~level)
    in
    if same_cell
    then (
      pick_point := None;
      clear_pick ();
      hide_pick_info ())
    else (
      pick_point := Some new_pt;
      render_pick ())
;;

let on_select_start x y =
  match raycast (float_of_int x) (float_of_int y) with
  | None -> ()
  | Some ((cx, cy, cz) as pt) ->
    selection_center := Some pt;
    selection_radius := 0.0;
    is_selecting := true;
    set_text "status" "Drag to set radius...";
    clear_cells ();
    set_text "cell-count" "0";
    show_selection cx cy cz 0.0
;;

let on_select_move x y =
  if !is_selecting
  then (
    match !selection_center with
    | None -> ()
    | Some center ->
      (match raycast (float_of_int x) (float_of_int y) with
       | None -> ()
       | Some pt ->
         selection_radius := angle_between center pt;
         update_covering ()))
;;

let on_select_end () =
  if !is_selecting
  then (
    is_selecting := false;
    set_text "status" "Ready")
;;

let () =
  (* Wait for globe.js to initialize, then set up callbacks *)
  let setup () =
    (* Register OCaml callbacks on the JS side *)
    Js.Unsafe.set
      window
      (Js.string "_s2viz_on_select_start")
      (Js.wrap_callback (fun x y -> on_select_start x y));
    Js.Unsafe.set
      window
      (Js.string "_s2viz_on_select_move")
      (Js.wrap_callback (fun x y -> on_select_move x y));
    Js.Unsafe.set
      window
      (Js.string "_s2viz_on_select_end")
      (Js.wrap_callback (fun _ev -> on_select_end ()));
    Js.Unsafe.set
      window
      (Js.string "_s2viz_on_pick")
      (Js.wrap_callback (fun x y -> on_pick x y));
    (* Slider change handlers *)
    let add_slider_listener ~slider_id ~value_id ~f =
      let el =
        Js.Unsafe.meth_call
          Js.Unsafe.global##.document
          "getElementById"
          [| Js.Unsafe.inject (Js.string slider_id) |]
      in
      Js.Unsafe.meth_call
        el
        "addEventListener"
        [| Js.Unsafe.inject (Js.string "input")
         ; Js.Unsafe.inject
             (Js.wrap_callback (fun _ev ->
                set_text value_id (string_of_int (get_slider_int slider_id));
                f ()))
        |]
      |> ignore
    in
    add_slider_listener
      ~slider_id:"level-slider"
      ~value_id:"level-val"
      ~f:(fun () -> update_covering (); render_pick ());
    add_slider_listener
      ~slider_id:"maxcells-slider"
      ~value_id:"maxcells-val"
      ~f:update_covering;
    (* Interior covering toggle: just rerun covering. *)
    let add_change_listener ~id ~f =
      let el =
        Js.Unsafe.meth_call
          Js.Unsafe.global##.document
          "getElementById"
          [| Js.Unsafe.inject (Js.string id) |]
      in
      Js.Unsafe.meth_call
        el
        "addEventListener"
        [| Js.Unsafe.inject (Js.string "change")
         ; Js.Unsafe.inject (Js.wrap_callback (fun _ev -> f ()))
        |]
      |> ignore
    in
    add_change_listener ~id:"interior-toggle" ~f:update_covering;
    set_text "status" "Ready"
  in
  (* Use requestAnimationFrame to ensure globe.js has loaded *)
  ignore
    (Js.Unsafe.meth_call
       window
       "setTimeout"
       [| Js.Unsafe.inject (Js.wrap_callback (fun () -> setup ()))
        ; Js.Unsafe.inject 100
       |])
;;
