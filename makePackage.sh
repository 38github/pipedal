export CFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
export CXXFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
export LDFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
cd build
cpack -G DEB -C Release -config CPackConfig.cmake 
cd ..
