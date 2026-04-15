// JS runtime stubs for OCaml primitives that jsoo doesn't ship by default
// but that Core/ppx_jane rely on.

// Architecture detection: Core requires exactly one to be true.

//Provides: caml_sys_const_arch_amd64
function caml_sys_const_arch_amd64() { return 1; }

//Provides: caml_sys_const_arch_arm64
function caml_sys_const_arch_arm64() { return 0; }

//Provides: caml_sys_const_arch_i386
function caml_sys_const_arch_i386() { return 0; }

//Provides: caml_sys_const_arch_power
function caml_sys_const_arch_power() { return 0; }

//Provides: caml_sys_const_arch_riscv
function caml_sys_const_arch_riscv() { return 0; }

//Provides: caml_sys_const_arch_s390x
function caml_sys_const_arch_s390x() { return 0; }

// Domain TLS: jsoo is single-threaded so a single global slot is enough.

//Provides: caml_domain_tls_set
function caml_domain_tls_set(v) { globalThis.__ocaml_domain_tls = v; return 0; }

//Provides: caml_domain_tls_get
function caml_domain_tls_get() {
  return globalThis.__ocaml_domain_tls !== undefined
    ? globalThis.__ocaml_domain_tls
    : 0;
}

//Provides: caml_ml_domain_unique_token
function caml_ml_domain_unique_token() { return [0]; }

//Provides: caml_ml_domain_set_name
function caml_ml_domain_set_name(_name) { return 0; }

// Thread stubs (systhreads): jsoo is single-threaded.

//Provides: caml_thread_initialize
function caml_thread_initialize() { return 0; }

//Provides: caml_thread_cleanup
function caml_thread_cleanup() { return 0; }

//Provides: caml_thread_new
function caml_thread_new(_f) { return 0; }

//Provides: caml_thread_self
function caml_thread_self() { return 0; }

//Provides: caml_thread_id
function caml_thread_id(_t) { return 0; }

//Provides: caml_thread_yield
function caml_thread_yield() { return 0; }

//Provides: caml_thread_join
function caml_thread_join(_t) { return 0; }

//Provides: caml_thread_exit
function caml_thread_exit() { return 0; }

//Provides: caml_thread_uncaught_exception
function caml_thread_uncaught_exception(_e) { return 0; }

//Provides: caml_mutex_new
function caml_mutex_new() { return [0]; }

//Provides: caml_mutex_lock
function caml_mutex_lock(_m) { return 0; }

//Provides: caml_mutex_unlock
function caml_mutex_unlock(_m) { return 0; }

//Provides: caml_mutex_try_lock
function caml_mutex_try_lock(_m) { return 1; }
