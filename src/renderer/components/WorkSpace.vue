<script lang="ts" setup>
import useWorkSpace from '@/hooks/useWorkSpace'

const { workSpace } = useWorkSpace()
</script>

<template>
  <div class="WorkSpace">
    {{ workSpace }}
  </div>
</template>

<style lang="less" scoped>

</style>
