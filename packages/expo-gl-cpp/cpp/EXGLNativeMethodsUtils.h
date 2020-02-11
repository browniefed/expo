#pragma once

#include <jsi/jsi.h>
#include <type_traits>

namespace jsi = facebook::jsi;

//
// unpackArg function is set of function overload and explicit specialization used to convert
// raw jsi::Value into specified (at compile time) type.
//
// Why we need to mix explicit specializations and function overloads?
// On the one hand we need to provide implementations for a range of types (e.g. all integers,
// all floats) so we can't do this with explicit specializations only, on the other hand we can't use 
// only function overloads because only difference in signature is caused by return type which 
// does not affect overloading.
//
// To prevent ambiguity all specializations should be directly under first unimplemented declaration
// of this function, and all new function overloads should be implemented under specializations
//

template <typename T>
inline constexpr bool is_integral_v = std::is_integral_v<T> && !std::is_same_v<bool, T>;

template <typename T>
inline std::enable_if_t<!(is_integral_v<T> || std::is_floating_point_v<T>), T> unpackArg(
    jsi::Runtime &runtime,
    const jsi::Value *jsArgv);

//
// unpackArgs explicit specializations
//

template <>
inline bool unpackArg<bool>(jsi::Runtime &runtime, const jsi::Value *jsArgv) {
  if (jsArgv->isBool()) {
    return jsArgv->getBool();
  } else if (jsArgv->isNull() || jsArgv->isUndefined()) {
    return false;
  } else if (jsArgv->isNumber()) {
    return jsArgv->getNumber() != 0;
  }
  throw std::runtime_error("value is not a boolean");
}

template <>
inline jsi::Object unpackArg<jsi::Object>(jsi::Runtime &runtime, const jsi::Value *jsArgv) {
  return jsArgv->getObject(runtime);
}

template <>
inline jsi::Array unpackArg<jsi::Array>(jsi::Runtime &runtime, const jsi::Value *jsArgv) {
  return jsArgv->getObject(runtime).getArray(runtime);
}

template <>
inline jsi::TypedArrayBase unpackArg<jsi::TypedArrayBase>(
    jsi::Runtime &runtime,
    const jsi::Value *jsArgv) {
  return jsArgv->getObject(runtime).getTypedArray(runtime);
}

template <>
inline jsi::ArrayBuffer unpackArg<jsi::ArrayBuffer>(
    jsi::Runtime &runtime,
    const jsi::Value *jsArgv) {
  return jsArgv->getObject(runtime).getArrayBuffer(runtime);
}

//
// unpackArgs function overloads
//

template <typename T>
inline std::enable_if_t<is_integral_v<T>, T> unpackArg(
    jsi::Runtime &runtime,
    const jsi::Value *jsArgv) {
  return jsArgv->asNumber(); // TODO: add api to jsi to handle integers more efficiently
}

template <typename T>
inline std::enable_if_t<std::is_floating_point_v<T>, T> unpackArg(
    jsi::Runtime &runtime,
    const jsi::Value *jsArgv) {
  return jsArgv->asNumber();
}

// set of private helpers, do not use directly
namespace methodHelper {

template <typename T>
struct Arg {
  const jsi::Value *ptr;
  T unpack(jsi::Runtime &runtime) {
    return unpackArg<T>(runtime, ptr);
  }
};

// Create tuple of arguments packped in helper class
// Wrapping is added to preserve mapping between type and pointer to jsi::Value
template <typename First, typename... T>
constexpr std::tuple<Arg<First>, Arg<T>...> toArgTuple(const jsi::Value *jsArgv) {
  if constexpr (sizeof...(T) >= 1) {
    return std::tuple_cat(std::make_tuple(Arg<First>{jsArgv}), toArgTuple<T...>(jsArgv + 1));
  } else {
    return std::make_tuple(Arg<First>{jsArgv});
  }
}

// We need to unpack this in separate step because unpackArg
// used in Arg class is not an constexpr.
template <typename Tuple, size_t... I>
auto unpackArgsTuple(jsi::Runtime &runtime, Tuple tuple, std::index_sequence<I...>) {
  return std::make_tuple(std::get<I>(tuple).unpack(runtime)...);
}

template <typename Tuple, typename F, size_t... I>
auto generateNativeMethodBind(F fn, Tuple tuple, std::index_sequence<I...>) {
  return std::bind(fn, std::get<I>(tuple)...);
}

} // namespace methodHelper

//
// unpackArgs is parsing arguments passed to function from JS
// conversion from *jsi::Value to declared type is done by specici specialization or overloads
// of unpackArg method defined above
//
// e.g. usage
// auto [ arg1, arg2, arg3 ] = unpackArgs<int, string, js::Object>(runtime, jsArgv, argc)
// used in EXGLNativeMethods wrapped in ARGS macro
//
template <typename... T>
inline std::tuple<T...> unpackArgs(jsi::Runtime &runtime, const jsi::Value *jsArgv, int argc) {
  // create tuple of Arg<T> structs containg pointer to unprocessed argument
  auto argTuple = methodHelper::toArgTuple<T...>(jsArgv);

  // transform tuple by running unpackArg<T>() on every element
  return methodHelper::unpackArgsTuple(runtime, argTuple, std::make_index_sequence<sizeof...(T)>());
}

//
// converts jsi::Value's passed to js method into c++ values based on type of declaration
// of OpenGl function
// e.g.
// NATIVE_METHOD(scissor) {
//   addToNextBatch(generateNativeMethod(runtime, glScissor, jsArgv, argc));
//   return nullptr;
// }
template <typename... T>
auto generateNativeMethod(jsi::Runtime &runtime, void fn(T...), const jsi::Value *jsArgv) {
  // generate tuple of arguements of correct type
  auto argTuple = unpackArgs<T...>(runtime, jsArgv, sizeof...(T));
  
  // bind tuple values as consecutive function arguements
  return methodHelper::generateNativeMethodBind(
      fn, argTuple, std::make_index_sequence<sizeof...(T)>());
}
