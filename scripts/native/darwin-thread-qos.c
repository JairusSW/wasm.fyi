// Thread-start QoS policy. No hooks run in benchmark calls. This requests a
// scheduling class; it does not pin threads to a physical CPU.
#include <errno.h>
#include <pthread.h>
#include <pthread/qos.h>
#include <stdio.h>
#include <stdlib.h>

struct start_context {
    void *(*start)(void *);
    void *argument;
};

static void set_qos(void) {
    int error = pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
    if (error) {
        fprintf(stderr, "benchmark thread QoS failed: %d\n", error);
        abort();
    }
}

__attribute__((constructor)) static void initialize_qos(void) { set_qos(); }

static void *start_with_qos(void *opaque) {
    struct start_context context = *(struct start_context *)opaque;
    free(opaque);
    set_qos();
    return context.start(context.argument);
}

static int create_with_qos(pthread_t *thread, const pthread_attr_t *attributes,
                           void *(*start)(void *), void *argument) {
    struct start_context *context = malloc(sizeof(*context));
    if (!context) return ENOMEM;
    *context = (struct start_context){start, argument};
    // dyld leaves references from the interposing image bound to the original.
    int error = pthread_create(thread, attributes, start_with_qos, context);
    if (error) free(context);
    return error;
}

__attribute__((used, section("__DATA,__interpose")))
static const struct {
    const void *replacement;
    const void *original;
} thread_interpose = {(const void *)create_with_qos, (const void *)pthread_create};
