#!/usr/bin/bash
export CFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
export CXXFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
export LDFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
/usr/bin/cmake --build build --config RelWithDebInfo --target all 
